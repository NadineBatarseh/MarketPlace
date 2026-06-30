import { useCallback } from 'react';
import { useGoogleReCaptcha } from 'react-google-recaptcha-v3';

export function useRecaptcha() {
  const { executeRecaptcha } = useGoogleReCaptcha();

  const getToken = useCallback(
    async (action: string): Promise<string> => {
      if (!executeRecaptcha) throw new Error('reCAPTCHA not ready');
      return executeRecaptcha(action);
    },
    [executeRecaptcha]
  );

  return { getToken };
}
