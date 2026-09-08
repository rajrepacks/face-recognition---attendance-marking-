import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

const STATUS = {
  starting: "starting",
  ready: "ready",
  denied: "denied",
  missing: "missing",
  error: "error",
};

/**
 * Live webcam preview. Parents grab a still with ref.current.capture(),
 * which returns a JPEG data URL (or null while the stream is not ready).
 */
const WebcamCapture = forwardRef(function WebcamCapture({ className = "" }, ref) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [status, setStatus] = useState(STATUS.starting);
  const [detail, setDetail] = useState("");

  useEffect(() => {
    let stream = null;
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus(STATUS.error);
        setDetail(
          "This browser does not expose getUserMedia. Use http://localhost or HTTPS in a modern browser."
        );
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStatus(STATUS.ready);
      } catch (err) {
        if (cancelled) return;
        const name = err && err.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
          setStatus(STATUS.denied);
          setDetail("Camera permission was denied. Allow it in the browser and reload the page.");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setStatus(STATUS.missing);
          setDetail("No camera was found on this device.");
        } else if (name === "NotReadableError") {
          setStatus(STATUS.error);
          setDetail("The camera is already in use by another application.");
        } else {
          setStatus(STATUS.error);
          setDetail((err && err.message) || "The camera could not be started.");
        }
      }
    }

    start();
    return () => {
      cancelled = true;
      if (stream) stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useImperativeHandle(ref, () => ({
    ready: () => status === STATUS.ready,
    capture: () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return null;
      if (!video.videoWidth || !video.videoHeight) return null;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.92);
    },
  }));

  return (
    <div className={className}>
      <div className="relative overflow-hidden rounded-lg border border-slate-300 bg-slate-900 aspect-[4/3]">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`h-full w-full object-cover ${status === STATUS.ready ? "" : "opacity-0"}`}
        />
        {status !== STATUS.ready && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            <div className="text-sm text-slate-200">
              {status === STATUS.starting && <p>Requesting camera access...</p>}
              {status === STATUS.denied && (
                <>
                  <p className="font-semibold text-red-300">Camera blocked</p>
                  <p className="mt-1 text-slate-300">{detail}</p>
                </>
              )}
              {status === STATUS.missing && (
                <>
                  <p className="font-semibold text-amber-300">No camera detected</p>
                  <p className="mt-1 text-slate-300">{detail}</p>
                </>
              )}
              {status === STATUS.error && (
                <>
                  <p className="font-semibold text-red-300">Camera error</p>
                  <p className="mt-1 text-slate-300">{detail}</p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
});

export default WebcamCapture;
