import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSupabase } from '@/context/SupabaseContext.jsx';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { authClient } = useSupabase();
  const [status, setStatus] = useState('verifying'); // verifying, success, error
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    async function verifyEmail() {
      const tokenHash = searchParams.get('token_hash');
      const type = searchParams.get('type');

      if (!tokenHash || !type) {
        setStatus('error');
        setErrorMessage('Invalid verification link. Missing required parameters.');
        return;
      }

      if (!authClient) {
        setStatus('error');
        setErrorMessage('Authentication service is not available.');
        return;
      }

      try {
        const { data, error } = await authClient.auth.verifyOtp({
          token_hash: tokenHash,
          type: type,
        });

        if (error) {
          throw error;
        }

        if (data?.user) {
          setStatus('success');
          // Redirect to dashboard after 2 seconds
          setTimeout(() => {
            navigate('/', { replace: true });
          }, 2000);
        } else {
          throw new Error('Verification completed but no user data returned.');
        }
      } catch (error) {
        console.error('Email verification failed:', error);
        setStatus('error');
        setErrorMessage(
          error.message || 'Failed to verify email. The link may have expired or is invalid.'
        );
      }
    }

    verifyEmail();
  }, [searchParams, authClient, navigate]);

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logoContainer}>
          <img src="/icon.svg" alt="Logo" style={styles.logo} />
        </div>

        {status === 'verifying' && (
          <>
            <h1 style={styles.title}>מאמת את כתובת המייל...</h1>
            <div style={styles.spinner}></div>
            <p style={styles.text}>אנא המתן בזמן שאנו מאמתים את חשבונך.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={styles.successIcon}>✓</div>
            <h1 style={styles.title}>המייל אומת בהצלחה!</h1>
            <p style={styles.text}>החשבון שלך הופעל. מעביר אותך ללוח הבקרה...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={styles.errorIcon}>✕</div>
            <h1 style={styles.title}>האימות נכשל</h1>
            <p style={styles.errorText}>{errorMessage}</p>
            <button
              onClick={() => navigate('/login', { replace: true })}
              style={styles.button}
            >
              חזרה להתחברות
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
    padding: '20px',
  },
  card: {
    backgroundColor: 'white',
    padding: '40px',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
    maxWidth: '500px',
    width: '100%',
    textAlign: 'center',
  },
  logoContainer: {
    marginBottom: '30px',
  },
  logo: {
    width: '80px',
    height: 'auto',
  },
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#111',
    marginBottom: '16px',
    direction: 'rtl',
  },
  text: {
    fontSize: '16px',
    color: '#666',
    marginBottom: '20px',
    direction: 'rtl',
  },
  errorText: {
    fontSize: '16px',
    color: '#dc2626',
    marginBottom: '24px',
    direction: 'rtl',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #f3f3f3',
    borderTop: '4px solid #2563EB',
    borderRadius: '50%',
    margin: '20px auto',
    animation: 'spin 1s linear infinite',
  },
  successIcon: {
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    backgroundColor: '#10b981',
    color: 'white',
    fontSize: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 20px',
    fontWeight: 'bold',
  },
  errorIcon: {
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    backgroundColor: '#dc2626',
    color: 'white',
    fontSize: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 20px',
    fontWeight: 'bold',
  },
  button: {
    backgroundColor: '#2563EB',
    color: 'white',
    padding: '12px 24px',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
};

// Add keyframe animation for spinner
const styleSheet = document.styleSheets[0];
if (styleSheet) {
  try {
    styleSheet.insertRule(`
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `, styleSheet.cssRules.length);
  } catch (error) {
    // Ignore if rule already exists
    void error;
  }
}
