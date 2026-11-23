"use client";

import { useRouter, useSearchParams } from "next/navigation";
import QrScanner from "qr-scanner";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Notice } from "@/components/ui";
import { useConfig } from "@/lib/client/config";

function EnterInner() {
  const router = useRouter();
  const params = useSearchParams();
  const config = useConfig();
  const ticket = params.get("ticket");
  const videoRef = useRef<HTMLVideoElement>(null);
  const handled = useRef(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [link, setLink] = useState("");

  // The code only names the event. Chain and contract always come from the app's own configuration.
  const open = useCallback(
    (text: string) => {
      let url: URL;
      try {
        url = new URL(text.trim(), window.location.origin);
      } catch {
        setScanError("That is not a TicketLock entry code.");
        return false;
      }
      const trusted = [window.location.origin, config.appUrl].includes(url.origin);
      const eventId = url.searchParams.get("eventId");
      if (!trusted || url.pathname !== "/admit" || !eventId || !/^\d+$/.test(eventId)) {
        setScanError("That is not a TicketLock entry code.");
        return false;
      }
      router.push("/admit?eventId=" + eventId + (ticket ? "&ticket=" + ticket : ""));
      return true;
    },
    [router, ticket, config.appUrl],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const scanner = new QrScanner(
      video,
      (result) => {
        if (handled.current) return;
        handled.current = open(result.data);
      },
      { preferredCamera: "environment", highlightScanRegion: true, highlightCodeOutline: true, maxScansPerSecond: 8 },
    );
    scanner.start().catch(() => {
      setCameraError("The camera is not available. Allow camera access for this site, or open the entry link below.");
    });
    return () => {
      scanner.stop();
      scanner.destroy();
    };
  }, [open]);

  return (
    <div className="mx-auto max-w-xl px-5 py-8 sm:px-8 sm:py-12">
      <h1 className="text-4xl font-extrabold tracking-tight">Scan the door code</h1>
      <p className="mt-2 text-body">Point your camera at the code displayed by event staff.</p>

      <div className="relative mt-6 aspect-square overflow-hidden rounded-[12px] bg-ink">
        <video ref={videoRef} className="size-full object-cover" muted playsInline />
        {cameraError && (
          <div className="absolute inset-0 grid place-items-center p-8 text-center text-white/85">{cameraError}</div>
        )}
      </div>
      {scanError && <div className="mt-4"><Notice>{scanError}</Notice></div>}

      <form
        className="mt-8 border-t border-line pt-6"
        onSubmit={(event) => {
          event.preventDefault();
          open(link);
        }}
      >
        <label className="eyebrow mb-2 block text-body" htmlFor="entry-link">
          No camera? Paste the entry link
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="entry-link"
            className="field"
            placeholder="https://…/admit?eventId=1"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
          />
          <button className="btn btn-outline shrink-0" disabled={!link}>
            Open entry link
          </button>
        </div>
      </form>
    </div>
  );
}

export default function EnterPage() {
  return (
    <Suspense>
      <EnterInner />
    </Suspense>
  );
}
