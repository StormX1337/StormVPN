//! WireGuard tunnel control on Windows via the official embeddable tunnel
//! library (`tunnel.dll` from wireguard-windows + `wireguard.dll` from
//! wireguard-nt). The tunnel runs as a Windows service that executes this
//! binary with `/service <config>`; see
//! https://git.zx2c4.com/wireguard-windows/about/embeddable-dll-service/README.md
//!
//! Full-tunnel configs (0.0.0.0/0, ::/0) automatically get wireguard-windows'
//! firewall based kill switch and DNS leak protection.

pub const TUNNEL_NAME: &str = "StormVPN";

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TunnelState {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
}

/// Live counters of the tunnel peer, read from the WireGuard adapter.
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelStats {
    /// Bytes received from the server (download).
    pub rx_bytes: u64,
    /// Bytes sent to the server (upload).
    pub tx_bytes: u64,
    /// Unix time of the last handshake in milliseconds (0 = none yet).
    pub last_handshake_ms: u64,
}

#[cfg(windows)]
mod imp {
    use super::{TunnelState, TUNNEL_NAME};
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::process::CommandExt;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};
    use windows_service::service::{
        ServiceAccess, ServiceDependency, ServiceErrorControl, ServiceInfo, ServiceSidType,
        ServiceStartType, ServiceState, ServiceType,
    };
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};

    const ERROR_SERVICE_DOES_NOT_EXIST: i32 = 1060;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn service_name() -> String {
        format!("WireGuardTunnel${TUNNEL_NAME}")
    }

    fn config_dir() -> PathBuf {
        let base = std::env::var_os("ProgramData").unwrap_or_else(|| "C:\\ProgramData".into());
        PathBuf::from(base).join("StormVPN")
    }

    fn config_path() -> PathBuf {
        config_dir().join(format!("{TUNNEL_NAME}.conf"))
    }

    fn not_found(error: &windows_service::Error) -> bool {
        matches!(error, windows_service::Error::Winapi(e) if e.raw_os_error() == Some(ERROR_SERVICE_DOES_NOT_EXIST))
    }

    fn err(context: &str, error: impl std::fmt::Display) -> String {
        format!("{context}: {error}")
    }

    /// Writes the config into a directory only SYSTEM and Administrators can read.
    fn write_config(config: &str) -> Result<PathBuf, String> {
        let dir = config_dir();
        std::fs::create_dir_all(&dir).map_err(|e| err("create config directory", e))?;
        let status = std::process::Command::new("icacls")
            .arg(&dir)
            .args([
                "/inheritance:r",
                "/grant:r",
                "*S-1-5-18:(OI)(CI)F",
                "/grant:r",
                "*S-1-5-32-544:(OI)(CI)F",
                "/q",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|e| err("restrict config directory", e))?;
        if !status.success() {
            return Err("restrict config directory: icacls failed".into());
        }
        let path = config_path();
        std::fs::write(&path, config).map_err(|e| err("write tunnel config", e))?;
        Ok(path)
    }

    fn manager(access: ServiceManagerAccess) -> Result<ServiceManager, String> {
        ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT | access)
            .map_err(|e| err("open service manager (administrator rights required)", e))
    }

    /// Stops and deletes the tunnel service and waits until Windows has removed it.
    pub fn disconnect() -> Result<(), String> {
        let manager = manager(ServiceManagerAccess::empty())?;
        let access = ServiceAccess::QUERY_STATUS | ServiceAccess::STOP | ServiceAccess::DELETE;
        match manager.open_service(service_name(), access) {
            Ok(service) => {
                let _ = service.stop();
                let deadline = Instant::now() + Duration::from_secs(15);
                while Instant::now() < deadline {
                    match service.query_status() {
                        Ok(status) if status.current_state != ServiceState::Stopped => {
                            std::thread::sleep(Duration::from_millis(200))
                        }
                        _ => break,
                    }
                }
                service
                    .delete()
                    .map_err(|e| err("delete tunnel service", e))?;
            }
            Err(e) if not_found(&e) => {}
            Err(e) => return Err(err("open tunnel service", e)),
        }
        // Deletion completes once the last handle is closed.
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            match manager.open_service(service_name(), ServiceAccess::QUERY_STATUS) {
                Err(e) if not_found(&e) => break,
                _ => std::thread::sleep(Duration::from_millis(200)),
            }
        }
        let _ = std::fs::remove_file(config_path());
        Ok(())
    }

    pub fn connect(config: &str) -> Result<(), String> {
        disconnect()?;
        let path = write_config(config)?;
        let manager = manager(ServiceManagerAccess::CREATE_SERVICE)?;
        let info = ServiceInfo {
            name: OsString::from(service_name()),
            display_name: OsString::from("StormVPN Tunnel"),
            service_type: ServiceType::OWN_PROCESS,
            start_type: ServiceStartType::OnDemand,
            error_control: ServiceErrorControl::Normal,
            executable_path: std::env::current_exe().map_err(|e| err("locate executable", e))?,
            launch_arguments: vec![OsString::from("/service"), path.into_os_string()],
            dependencies: vec![
                ServiceDependency::Service(OsString::from("Nsi")),
                ServiceDependency::Service(OsString::from("TcpIp")),
            ],
            account_name: None,
            account_password: None,
        };
        let service = manager
            .create_service(
                &info,
                ServiceAccess::CHANGE_CONFIG | ServiceAccess::START | ServiceAccess::QUERY_STATUS,
            )
            .map_err(|e| err("create tunnel service", e))?;
        service
            .set_config_service_sid_info(ServiceSidType::Unrestricted)
            .map_err(|e| err("configure tunnel service", e))?;
        service
            .start::<&str>(&[])
            .map_err(|e| err("start tunnel service", e))?;
        Ok(())
    }

    pub fn state() -> TunnelState {
        let Ok(manager) = manager(ServiceManagerAccess::empty()) else {
            return TunnelState::Disconnected;
        };
        let Ok(service) = manager.open_service(service_name(), ServiceAccess::QUERY_STATUS) else {
            return TunnelState::Disconnected;
        };
        match service.query_status().map(|status| status.current_state) {
            Ok(ServiceState::Running) => TunnelState::Connected,
            Ok(ServiceState::StartPending) => TunnelState::Connecting,
            Ok(ServiceState::StopPending) => TunnelState::Disconnecting,
            _ => TunnelState::Disconnected,
        }
    }

    /// Reads the peer counters via wireguard.dll (`WireGuardGetConfiguration`).
    pub fn stats() -> Option<super::TunnelStats> {
        type Handle = *mut std::ffi::c_void;
        type OpenAdapter = unsafe extern "system" fn(*const u16) -> Handle;
        type CloseAdapter = unsafe extern "system" fn(Handle);
        type GetConfiguration = unsafe extern "system" fn(Handle, *mut u8, *mut u32) -> i32;
        // Offsets in the ALIGNED(8) structs of wireguard.h: WIREGUARD_INTERFACE is 80 bytes and
        // is followed by the first WIREGUARD_PEER (TxBytes @104, RxBytes @112, LastHandshake @120).
        const INTERFACE_SIZE: usize = 80;
        const PEERS_COUNT: usize = 72;
        const PEER_TX: usize = INTERFACE_SIZE + 104;
        const PEER_RX: usize = INTERFACE_SIZE + 112;
        const PEER_HANDSHAKE: usize = INTERFACE_SIZE + 120;
        // 100ns intervals between 1601-01-01 and 1970-01-01.
        const EPOCH_DIFF: u64 = 116_444_736_000_000_000;

        let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
        // SAFETY: wireguard.dll ships next to this binary; signatures follow wireguard.h and the
        // buffer is sized by the driver (ERROR_MORE_DATA protocol).
        unsafe {
            let library = libloading::Library::new(dir.join("wireguard.dll")).ok()?;
            let open = library.get::<OpenAdapter>(b"WireGuardOpenAdapter\0").ok()?;
            let close = library
                .get::<CloseAdapter>(b"WireGuardCloseAdapter\0")
                .ok()?;
            let get = library
                .get::<GetConfiguration>(b"WireGuardGetConfiguration\0")
                .ok()?;
            let name: Vec<u16> = TUNNEL_NAME
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            let adapter = open(name.as_ptr());
            if adapter.is_null() {
                return None;
            }
            let mut buffer = vec![0u8; 4096];
            let mut bytes = buffer.len() as u32;
            let mut ok = get(adapter, buffer.as_mut_ptr(), &mut bytes) != 0;
            if !ok && bytes as usize > buffer.len() {
                buffer = vec![0u8; bytes as usize];
                ok = get(adapter, buffer.as_mut_ptr(), &mut bytes) != 0;
            }
            close(adapter);
            if !ok || (bytes as usize) < PEER_HANDSHAKE + 8 {
                return None;
            }
            let u32_at =
                |offset: usize| u32::from_le_bytes(buffer[offset..offset + 4].try_into().unwrap());
            let u64_at =
                |offset: usize| u64::from_le_bytes(buffer[offset..offset + 8].try_into().unwrap());
            if u32_at(PEERS_COUNT) == 0 {
                return None;
            }
            let handshake = u64_at(PEER_HANDSHAKE);
            Some(super::TunnelStats {
                rx_bytes: u64_at(PEER_RX),
                tx_bytes: u64_at(PEER_TX),
                last_handshake_ms: handshake.saturating_sub(EPOCH_DIFF) / 10_000,
            })
        }
    }

    /// Entry point when Windows starts this binary as the tunnel service.
    pub fn run_service(config_file: &Path) -> bool {
        let Ok(exe) = std::env::current_exe() else {
            return false;
        };
        let Some(dir) = exe.parent() else {
            return false;
        };
        // SAFETY: tunnel.dll ships next to this binary and exports
        // `BOOL WireGuardTunnelService(LPCWSTR conf_file)` (cdecl).
        unsafe {
            let Ok(library) = libloading::Library::new(dir.join("tunnel.dll")) else {
                return false;
            };
            let Ok(run) =
                library.get::<unsafe extern "C" fn(*const u16) -> u8>(b"WireGuardTunnelService\0")
            else {
                return false;
            };
            let wide: Vec<u16> = config_file
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            run(wide.as_ptr()) != 0
        }
    }
}

#[cfg(not(windows))]
mod imp {
    //! Development stub for non-Windows hosts (UI work only).
    use super::TunnelState;

    pub fn connect(_config: &str) -> Result<(), String> {
        Err("The StormVPN tunnel is only available on Windows".into())
    }

    pub fn disconnect() -> Result<(), String> {
        Ok(())
    }

    pub fn state() -> TunnelState {
        TunnelState::Disconnected
    }

    pub fn stats() -> Option<super::TunnelStats> {
        None
    }
}

pub use imp::*;
