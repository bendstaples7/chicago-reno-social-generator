import { useState, useEffect, useRef } from 'react';
import { checkJobberSessionStatus } from '../api';

interface SessionExpiredBannerProps {
  onReconnected: () => void;
}

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export default function SessionExpiredBanner({ onReconnected }: SessionExpiredBannerProps) {
  const [polling, setPolling] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingInFlightRef = useRef(false);

  const stopPolling = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setPolling(false);
  };

  const [checking, setChecking] = useState(false);

  const handleReconnectClick = async () => {
    if (checking || polling) return;
    setChecking(true);

    // First check if the session was already refreshed (e.g. by the automated cookie refresh)
    try {
      const status = await checkJobberSessionStatus();
      if (status.configured && !status.expired) {
        setDismissed(true);
        onReconnected();
        return;
      }
    } catch {
      // Fall through to manual reconnect
    } finally {
      setChecking(false);
    }

    // Session still expired — open the manual cookie paste page and start polling
    window.open('/api/jobber-auth/set-cookies', '_blank', 'noopener,noreferrer');
    setPolling(true);
  };

  useEffect(() => {
    if (!polling) return;

    intervalRef.current = setInterval(async () => {
      if (pollingInFlightRef.current) return;
      pollingInFlightRef.current = true;
      try {
        const status = await checkJobberSessionStatus();
        if (status.configured && !status.expired) {
          stopPolling();
          setDismissed(true);
          onReconnected();
        }
      } catch {
        // Silently retry on next interval
      } finally {
        pollingInFlightRef.current = false;
      }
    }, POLL_INTERVAL_MS);

    // Stop polling after 5 minutes
    timeoutRef.current = setTimeout(() => {
      stopPolling();
    }, POLL_TIMEOUT_MS);

    return () => {
      stopPolling();
    };
  }, [polling, onReconnected]);

  if (dismissed) return null;

  return (
    <div style={bannerStyle} role="alert">
      <div style={contentStyle}>
        <span style={messageStyle}>
          ⚠️ Jobber session expired. Request details may be incomplete.
        </span>
        <button
          onClick={handleReconnectClick}
          style={buttonStyle}
          type="button"
          disabled={polling || checking}
        >
          {checking ? 'Checking…' : polling ? 'Waiting for reconnect…' : 'Reconnect Jobber Session'}
        </button>
      </div>
    </div>
  );
}

// ── Styles ──

const bannerStyle: React.CSSProperties = {
  background: '#fff3e0',
  border: '1px solid #ffe0b2',
  borderRadius: 6,
  padding: '0.75rem 1rem',
  marginTop: '0.75rem',
};

const contentStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  alignItems: 'flex-start',
};

const messageStyle: React.CSSProperties = {
  fontSize: '0.85rem',
  color: '#6d4c00',
  lineHeight: 1.4,
};

const buttonStyle: React.CSSProperties = {
  padding: '0.35rem 0.75rem',
  border: '1px solid #00a89d',
  background: '#00a89d',
  color: '#fff',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: '0.8rem',
  fontWeight: 500,
};
