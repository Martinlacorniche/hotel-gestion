"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Eraser, X, Check } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  onValidate: (dataUrl: string) => void;
};

export function SignaturePadModal({
  open,
  onOpenChange,
  title,
  subtitle,
  onValidate,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);

  // Re-init canvas (taille + clear) à chaque ouverture
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 2.5;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setHasDrawn(false);
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawing.current = true;
    lastPoint.current = getPoint(e);
    // Petit point initial pour permettre une signature « tap » courte
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && lastPoint.current) {
      ctx.beginPath();
      ctx.arc(lastPoint.current.x, lastPoint.current.y, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = "#0f172a";
      ctx.fill();
    }
    if (!hasDrawn) setHasDrawn(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !lastPoint.current) return;
    const p = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPoint.current = p;
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    lastPoint.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const validate = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;
    const dataUrl = canvas.toDataURL("image/png");
    onValidate(dataUrl);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {subtitle && (
            <p className="text-sm text-slate-500">{subtitle}</p>
          )}
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-xl border-2 border-dashed border-slate-300 bg-white overflow-hidden">
            <canvas
              ref={canvasRef}
              className="block w-full h-64 touch-none cursor-crosshair"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onPointerLeave={onPointerEnd}
            />
          </div>
          <p className="text-xs text-slate-500 text-center">
            Signez avec le doigt ou un stylet dans le cadre ci-dessus
          </p>

          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              variant="outline"
              onClick={clear}
              disabled={!hasDrawn}
              className="text-sm"
            >
              <Eraser className="w-4 h-4 mr-1.5" /> Effacer
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="text-sm"
              >
                <X className="w-4 h-4 mr-1.5" /> Annuler
              </Button>
              <Button
                onClick={validate}
                disabled={!hasDrawn}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
              >
                <Check className="w-4 h-4 mr-1.5" /> Valider la signature
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
