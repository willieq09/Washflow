import React, { useEffect, useRef, useState } from 'react';

// Declare types for window.tt
declare global {
  interface Window {
    tt?: any;
  }
}

interface TomTomMapProps {
  apiKey: string;
  lat: number;
  lng: number;
  zoom?: number;
  onDragEnd: (lat: number, lng: number) => void;
}

const loadTomTomSDK = (): Promise<any> => {
  return new Promise((resolve, reject) => {
    if (window.tt) {
      resolve(window.tt);
      return;
    }

    // Load CSS
    if (!document.getElementById('tomtom-css')) {
      const link = document.createElement('link');
      link.id = 'tomtom-css';
      link.rel = 'stylesheet';
      link.type = 'text/css';
      link.href = 'https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/maps/maps.css';
      document.head.appendChild(link);
    }

    // Load JS
    if (document.getElementById('tomtom-js')) {
      // Script is already loading, wait for window.tt to be available
      const interval = setInterval(() => {
        if (window.tt) {
          clearInterval(interval);
          resolve(window.tt);
        }
      }, 100);
      return;
    }

    const script = document.createElement('script');
    script.id = 'tomtom-js';
    script.src = 'https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/maps/maps-web.min.js';
    script.async = true;
    script.onload = () => {
      resolve(window.tt);
    };
    script.onerror = (err) => {
      reject(err);
    };
    document.body.appendChild(script);
  });
};

export function TomTomMap({ apiKey, lat, lng, zoom = 15, onDragEnd }: TomTomMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load SDK once
  useEffect(() => {
    loadTomTomSDK()
      .then(() => {
        setSdkLoaded(true);
      })
      .catch((err) => {
        console.error('Failed to load TomTom Maps SDK:', err);
        setError('Failed to load TomTom Maps SDK.');
      });
  }, []);

  // Initialize Map
  useEffect(() => {
    if (!sdkLoaded || !containerRef.current || !window.tt) return;

    try {
      // TomTom uses [lng, lat] for coordinates!
      const mapInstance = window.tt.map({
        key: apiKey,
        container: containerRef.current,
        center: [lng || 0, lat || 0],
        zoom: zoom,
        dragPan: true,
        scrollZoom: true,
        attributionControl: false
      });

      mapRef.current = mapInstance;

      // Add navigation controls (zoom, compass)
      mapInstance.addControl(new window.tt.NavigationControl({
        showCompass: false,
        showZoom: true
      }));

      // Create a draggable marker
      const markerInstance = new window.tt.Marker({
        draggable: true
      })
        .setLngLat([lng || 0, lat || 0])
        .addTo(mapInstance);

      markerRef.current = markerInstance;

      // Listen for marker drag and update parent
      markerInstance.on('dragend', () => {
        const newLngLat = markerInstance.getLngLat();
        if (newLngLat) {
          onDragEnd(newLngLat.lat, newLngLat.lng);
        }
      });

      // Click on map updates marker position and parent coords
      mapInstance.on('click', (e: any) => {
        if (e.lngLat) {
          markerInstance.setLngLat(e.lngLat);
          onDragEnd(e.lngLat.lat, e.lngLat.lng);
        }
      });

      return () => {
        if (mapRef.current) {
          mapRef.current.remove();
          mapRef.current = null;
          markerRef.current = null;
        }
      };
    } catch (err) {
      console.error('Error initializing map:', err);
      setError('Could not initialize TomTom Map with your API key.');
    }
  }, [sdkLoaded, apiKey]);

  // Update center & marker dynamically when props change
  useEffect(() => {
    if (!mapRef.current || !markerRef.current || !window.tt) return;

    const currentMarkerLngLat = markerRef.current.getLngLat();
    if (currentMarkerLngLat) {
      const isDifferent = 
        Math.abs(currentMarkerLngLat.lat - lat) > 0.00001 || 
        Math.abs(currentMarkerLngLat.lng - lng) > 0.00001;

      if (isDifferent) {
        markerRef.current.setLngLat([lng || 0, lat || 0]);
        mapRef.current.easeTo({
          center: [lng || 0, lat || 0],
          duration: 400
        });
      }
    }
  }, [lat, lng]);

  if (error) {
    return (
      <div className="w-full h-full bg-bg border border-border flex items-center justify-center p-6 text-center text-red-500 font-bold uppercase text-[10px] tracking-widest rounded-3xl">
        {error}
      </div>
    );
  }

  if (!sdkLoaded) {
    return (
      <div className="w-full h-full bg-bg/50 border border-border flex flex-col items-center justify-center p-6 text-center rounded-3xl gap-3">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <span className="text-[10px] font-black uppercase text-accent tracking-[0.2em]">BOOTING STATION SENSORS...</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      <div ref={containerRef} className="w-full h-full rounded-[2rem]" />
      <style>{`
        .tt-popup-content {
          background: #141416 !important;
          color: #FCFDFE !important;
          border-radius: 12px;
          border: 1px solid #23262F;
        }
        .tt-popup-anchor-top .tt-popup-tip {
          border-bottom-color: #141416 !important;
        }
        .mapboxgl-ctrl-group {
          background-color: rgba(20, 20, 22, 0.8) !important;
          backdrop-filter: blur(12px) !important;
          border: 1px solid rgba(255, 255, 255, 0.08) !important;
          border-radius: 12px !important;
        }
        .mapboxgl-ctrl-group button {
          width: 36px !important;
          height: 36px !important;
          color: #FCFDFE !important;
        }
        .mapboxgl-ctrl-icon {
          filter: invert(1) brightness(2) !important;
        }
      `}</style>
    </div>
  );
}
