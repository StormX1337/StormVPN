//! Session secrets (refresh token) in the Windows Credential Manager.

#[cfg(windows)]
mod imp {
    const SERVICE: &str = "StormVPN";

    fn entry(key: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())
    }

    pub fn get(key: &str) -> Result<Option<String>, String> {
        match entry(key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn set(key: &str, value: &str) -> Result<(), String> {
        entry(key)?.set_password(value).map_err(|e| e.to_string())
    }

    pub fn delete(key: &str) -> Result<(), String> {
        match entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(not(windows))]
mod imp {
    //! Development stub: in-memory only.
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};

    fn store() -> &'static Mutex<HashMap<String, String>> {
        static STORE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
        STORE.get_or_init(Default::default)
    }

    pub fn get(key: &str) -> Result<Option<String>, String> {
        Ok(store().lock().map_err(|e| e.to_string())?.get(key).cloned())
    }

    pub fn set(key: &str, value: &str) -> Result<(), String> {
        store()
            .lock()
            .map_err(|e| e.to_string())?
            .insert(key.to_owned(), value.to_owned());
        Ok(())
    }

    pub fn delete(key: &str) -> Result<(), String> {
        store().lock().map_err(|e| e.to_string())?.remove(key);
        Ok(())
    }
}

pub use imp::*;
