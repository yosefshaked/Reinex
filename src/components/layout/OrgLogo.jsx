import React, { useEffect, useState } from 'react';
import { useOrg } from '@/org/OrgContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';

function LogoPlaceholder() {
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl overflow-hidden bg-white">
      <img 
        src="/icon.svg" 
        alt="Reinex" 
        className="h-full w-full object-contain p-1"
      />
    </div>
  );
}

export default function OrgLogo({ className = '' }) {
  const { activeOrgId } = useOrg();
  const [logoUrl, setLogoUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!activeOrgId) {
      setLogoUrl(null);
      setLoading(false);
      return;
    }

    const fetchLogo = async () => {
      setLoading(true);
      try {
        const data = await authenticatedFetch(`org-logo?org_id=${encodeURIComponent(activeOrgId)}`, {
          method: 'GET',
        });
        setLogoUrl(data?.logo_url || null);
      } catch (error) {
        console.error('Error fetching org logo:', error);
        setLogoUrl(null);
      } finally {
        setLoading(false);
      }
    };

    fetchLogo();
  }, [activeOrgId, refreshKey]);

  useEffect(() => {
    // Listen for logo update events
    const handleLogoUpdate = () => {
      setRefreshKey(prev => prev + 1);
    };

    window.addEventListener('org-logo-updated', handleLogoUpdate);
    return () => window.removeEventListener('org-logo-updated', handleLogoUpdate);
  }, []);

  if (loading) {
    return <LogoPlaceholder />;
  }

  if (!logoUrl) {
    return <LogoPlaceholder />;
  }

  return (
    <img 
      src={logoUrl} 
      alt="Organization Logo" 
      className={`h-12 w-12 rounded-2xl object-contain bg-white p-1 ${className}`}
    />
  );
}
