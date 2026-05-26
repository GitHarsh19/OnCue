import { useEffect, useRef, useState } from "react";

export function useCamera({ videoFile = null } = {}) {
  const videoRef = useRef(null);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const streamRef = useRef(null);
  const objectUrlRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);

    function cleanupStream() {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    function cleanupObjectUrl() {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    }

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Camera API not available in this browser.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.src = "";
          videoRef.current.loop = false;
          videoRef.current.muted = true;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current.play();
            setReady(true);
          };
        }
      } catch (e) {
        setError(
          e.name === "NotAllowedError"
            ? "Camera permission denied. Enable it in your browser settings to continue."
            : `Camera error: ${e.message}`
        );
      }
    }

    function startFile(file) {
      cleanupStream();
      cleanupObjectUrl();
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.src = url;
        videoRef.current.loop = true;
        videoRef.current.muted = true;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play();
          setReady(true);
        };
      }
    }

    if (videoFile) startFile(videoFile);
    else startCamera();

    return () => {
      cancelled = true;
      cleanupStream();
      cleanupObjectUrl();
    };
  }, [videoFile]);

  return { videoRef, error, ready };
}
