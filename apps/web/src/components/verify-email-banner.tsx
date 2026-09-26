'use client';

import { Alert, Button, toast } from '@stormvpn/ui';
import { useMutation } from '@tanstack/react-query';
import { MailWarning } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

export function VerifyEmailBanner() {
  const resend = useMutation({
    mutationFn: () => api.auth.resendVerification(),
    onSuccess: () => toast.success('Verification email sent'),
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Alert variant="warning" className="items-center">
      <MailWarning />
      <p className="flex-1">Confirm your email address to subscribe and connect. Check your inbox for the link.</p>
      <Button size="sm" variant="outline" disabled={resend.isPending} onClick={() => resend.mutate()}>
        Resend email
      </Button>
    </Alert>
  );
}
