"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { 
  format, parseISO, addMonths, subMonths, startOfMonth, endOfMonth, 
  eachDayOfInterval, isSameDay, isAfter, isBefore, isValid,
  differenceInCalendarDays, max, min, endOfDay, addDays
} from "date-fns";
import { fr } from "date-fns/locale";
import { 
  ChevronLeft, ChevronRight, User, Trash2, Edit2, PlusCircle, Save, Car, X, LayoutGrid, Clock, Search
} from "lucide-react";
import interact from "interactjs";

// --- TAILLES HARDCODÉES ---
const BOX_CONFIG: Record<string, { label: string; size: string }> = {
  "Box1": { label: "Box 9", size: "1.86m x 2.30m" },
  "Box2": { label: "Box 24", size: "1.84m x 2.22m" },
  "Box9": { label: "Box 9", size: "1.86m x 2.30m" },
  "Box24": { label: "Box 24", size: "1.84m x 2.22m" },
};

export default function ParkingPage() {
  const [parkings, setParkings] = useState<any[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);
  const [clientName, setClientName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedParking, setSelectedParking] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [popupReservation, setPopupReservation] = useState<any | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [tooltip, setTooltip] = useState<{ r: any; x: number; y: number } | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  useEffect(() => {
    fetchParkings();
    fetchReservations();
    document.title = 'Parking';
  }, []);

  useEffect(() => {
    if (scrollContainerRef.current) {
      const todayCell = scrollContainerRef.current.querySelector('.is-today');
      if (todayCell) {
        todayCell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [reservations, currentMonth]);

  useEffect(() => {
    interact('.draggable-reservation').resizable({
      edges: { left: true, right: true },
      listeners: {
        start() { isDragging.current = true; },
        move(event) {
          const target = event.target;
          let x = (parseFloat(target.getAttribute('data-x')) || 0);
          target.style.width = event.rect.width + 'px';
          x += event.deltaRect.left;
          target.style.transform = `translate(${x}px, 0px)`;
          target.setAttribute('data-x', x);
        },
        end(event) {
          handleInteractUpdate(event);
          setTimeout(() => { isDragging.current = false; }, 100);
        }
      }
    }).draggable({
      listeners: {
        start() { isDragging.current = true; },
        move(event) {
          const target = event.target;
          const x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx;
          const y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;
          target.style.transform = `translate(${x}px, ${y}px)`;
          target.setAttribute('data-x', x);
          target.setAttribute('data-y', y);
          target.style.zIndex = "1000";
        },
        end(event) {
          handleInteractUpdate(event);
          setTimeout(() => { isDragging.current = false; }, 100);
        }
      }
    });
    return () => { interact('.draggable-reservation').unset(); };
  }, [reservations, parkings, currentMonth]);

  async function fetchParkings() {
    const { data, error } = await supabase.from("parkings").select("*").order('name');
    if (!error && data) {
      setParkings(data);
      if (!selectedParking && data.length > 0) setSelectedParking(data[0].id);
    }
  }

  async function fetchReservations() {
    const { data, error } = await supabase.from("parking_reservations").select("*");
    if (!error && data) setReservations(data);
  }

  function handleCellClick(parkingId: string, date: Date) {
    if (isDragging.current) return;
    setSelectedParking(parkingId);
    setStartDate(format(date, 'yyyy-MM-dd'));
    setEndDate(format(date, 'yyyy-MM-dd'));
    setClientName("");
    setEditingId(null);
    setIsCreateModalOpen(true);
  }

  async function handleInteractUpdate(event: any) {
    const target = event.target;
    const resId = target.getAttribute('data-id');
    const originalRes = reservations.find(r => r.id === resId);
    
    if (!originalRes || !originalRes.start_date) return;

    const containerWidth = target.parentElement?.offsetWidth || 0;
    if (containerWidth === 0) return; 

    const dayWidth = containerWidth / monthDays.length;
    const deltaX = parseFloat(target.getAttribute('data-x')) || 0;
    const deltaDaysStart = Math.round(deltaX / dayWidth);
    const newWidthDays = Math.round(target.offsetWidth / dayWidth);
    
    const baseDate = parseISO(originalRes.start_date);
    if (!isValid(baseDate)) return;

    const newStart = addDays(baseDate, deltaDaysStart);
    const newEnd = addDays(newStart, Math.max(1, newWidthDays));

    if (!isValid(newStart) || !isValid(newEnd)) {
      console.error("Calcul de date invalide :", { newStart, newEnd });
      fetchReservations();
      return;
    }

    const deltaY = parseFloat(target.getAttribute('data-y')) || 0;
    const rowIndexDelta = Math.round(deltaY / 64); 
    const currentIdx = parkings.findIndex(p => p.id === originalRes.parking_id);
    const newIdx = Math.max(0, Math.min(parkings.length - 1, currentIdx + rowIndexDelta));
    const newParkingId = parkings[newIdx].id;

    const { error } = await supabase.from("parking_reservations").update({
      start_date: format(newStart, 'yyyy-MM-dd'),
      end_date: format(newEnd, 'yyyy-MM-dd'),
      parking_id: newParkingId
    }).eq("id", resId);

    if (error) console.error("Erreur Update:", error);

    target.setAttribute('data-x', 0);
    target.setAttribute('data-y', 0);
    target.style.transform = 'none';
    fetchReservations();
  }

  async function handleSave() {
    if (!selectedParking || !clientName || !startDate || !endDate) return;
    const payload = { parking_id: selectedParking, client_name: clientName, start_date: startDate, end_date: endDate };
    const { error } = editingId 
      ? await supabase.from("parking_reservations").update(payload).eq("id", editingId)
      : await supabase.from("parking_reservations").insert(payload);

    if (!error) {
      setIsCreateModalOpen(false);
      resetForm();
      fetchReservations();
    }
  }

  function handleEditFromPopup(r: any) {
    setClientName(r.client_name);
    setStartDate(r.start_date);
    setEndDate(r.end_date);
    setSelectedParking(r.parking_id);
    setEditingId(r.id);
    setPopupReservation(null);
    setIsCreateModalOpen(true);
  }

  async function handleDelete(id: string) {
    if(!confirm("Supprimer cette réservation ?")) return;
    await supabase.from("parking_reservations").delete().eq("id", id);
    fetchReservations();
    setPopupReservation(null);
  }

  function resetForm() {
    setClientName(""); setStartDate(""); setEndDate(""); setEditingId(null);
  }

  const monthDays = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) });

  // Réservations correspondant à la recherche situées en dehors du mois affiché
  const otherMonthMatches: { monthDate: Date; label: string; count: number }[] = (() => {
    if (!searchQuery.trim()) return [];
    const mStart = startOfMonth(currentMonth);
    const mEnd = endOfMonth(currentMonth);
    const matched = reservations.filter(r =>
      r.client_name.toLowerCase().includes(searchQuery.toLowerCase())
    );
    const byMonth: Record<string, { monthDate: Date; count: number }> = {};
    matched.forEach(r => {
      const rStart = parseISO(r.start_date);
      const rEnd = parseISO(r.end_date);
      // overlaps current month → skip
      if (!isAfter(rStart, mEnd) && !isBefore(rEnd, mStart)) return;
      const key = format(rStart, 'yyyy-MM');
      if (!byMonth[key]) byMonth[key] = { monthDate: startOfMonth(rStart), count: 0 };
      byMonth[key].count++;
    });
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => ({
        monthDate: v.monthDate,
        label: format(v.monthDate, 'MMM yyyy', { locale: fr }),
        count: v.count,
      }));
  })();

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,400;0,600;0,700;0,800;1,700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

        .pf-root {
          font-family: 'Barlow Condensed', sans-serif;
          background: #ECEEF1;
          color: #1F2228;
        }

        /* ── HEADER ── */
        .pf-header {
          height: 72px;
          background: #F4F5F7;
          border-bottom: 1px solid #D8DBE0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 28px;
          position: relative;
          z-index: 50;
          flex-shrink: 0;
        }

        .pf-logo-mark {
          width: 42px; height: 42px;
          background: #F0B429;
          border-radius: 11px;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 16px rgba(240,180,41,0.35);
          flex-shrink: 0;
        }

        .pf-logo-letter {
          font-family: 'Barlow Condensed', sans-serif;
          font-weight: 800;
          font-size: 24px;
          color: #fff;
          line-height: 1;
          margin-top: 2px;
        }

        .pf-app-name {
          font-family: 'Barlow Condensed', sans-serif;
          font-weight: 800;
          font-size: 20px;
          color: #1F2228;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          line-height: 1;
        }

        .pf-app-sub {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 9px;
          color: #A0A5AF;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          margin-top: 4px;
        }

        /* ── NAV PILL ── */
        .pf-nav-pill {
          display: flex;
          align-items: center;
          background: #ECEEF1;
          border: 1px solid #D0D3D9;
          border-radius: 14px;
          padding: 5px;
        }

        .pf-nav-btn {
          width: 36px; height: 36px;
          display: flex; align-items: center; justify-content: center;
          border-radius: 10px;
          background: transparent;
          border: none;
          color: #8A8F9C;
          cursor: pointer;
          transition: all 0.15s;
        }
        .pf-nav-btn:hover { background: #fff; color: #1F2228; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }

        .pf-month-label {
          font-family: 'Barlow Condensed', sans-serif;
          font-weight: 700;
          font-size: 17px;
          color: #3A3F4A;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          min-width: 190px;
          text-align: center;
        }

        /* ── CTA BUTTON ── */
        .pf-btn-primary {
          display: flex;
          align-items: center;
          gap: 8px;
          height: 42px;
          padding: 0 20px;
          background: #F0B429;
          color: #fff;
          border: none;
          border-radius: 10px;
          font-family: 'Barlow Condensed', sans-serif;
          font-weight: 700;
          font-size: 14px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 0.15s;
          box-shadow: 0 4px 16px rgba(240,180,41,0.3);
        }
        .pf-btn-primary:hover {
          background: #E8A812;
          box-shadow: 0 8px 24px rgba(240,180,41,0.4);
          transform: translateY(-1px);
        }
        .pf-btn-primary:active { transform: translateY(0); }

        /* ── GANTT CONTAINER ── */
        .pf-gantt-wrap {
          background: #F4F5F7;
          border: 1px solid #D0D3D9;
          border-radius: 18px;
          overflow: auto;
          -ms-overflow-style: none;
          scrollbar-width: none;
          box-shadow: 0 4px 24px rgba(0,0,0,0.06);
        }
        .pf-gantt-wrap::-webkit-scrollbar { display: none; }

        /* ── TABLE HEADER ── */
        .pf-thead-sticky {
          position: sticky;
          top: 0;
          z-index: 40;
        }

        .pf-th-label {
          background: #ECEEF1;
          border-bottom: 1px solid #D0D3D9;
          border-right: 1px solid #D0D3D9;
          position: sticky;
          left: 0;
          z-index: 50;
          width: 160px;
          padding: 0 20px;
          text-align: left;
          font-family: 'Barlow Condensed', sans-serif;
          font-weight: 700;
          font-size: 10px;
          color: #9BA0AD;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          box-shadow: 6px 0 16px rgba(0,0,0,0.04);
        }

        .pf-th-day {
          border-bottom: 1px solid #D0D3D9;
          border-left: 1px solid #E2E4E8;
          min-width: 48px;
          height: 64px;
          vertical-align: middle;
          background: #F4F5F7;
        }

        .pf-th-day.today-col { background: rgba(240,180,41,0.06); }

        .pf-day-abbr {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 9px;
          color: #B0B5C0;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          display: block;
          text-align: center;
        }

        .pf-day-num {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 13px;
          font-weight: 600;
          color: #6B7180;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          margin: 4px auto 0;
          border-radius: 7px;
        }

        .pf-day-num.is-today {
          background: rgba(240,180,41,0.15);
          color: #D49A20;
        }

        /* ── TABLE ROWS ── */
        .pf-tr {
          height: 64px;
          border-bottom: 1px solid #E2E4E8;
          transition: background 0.12s;
          background: #F4F5F7;
        }
        .pf-tr:last-child { border-bottom: none; }
        .pf-tr:hover { background: #EFF0F3; }

        .pf-td-label {
          position: sticky;
          left: 0;
          background: #ECEEF1;
          border-right: 1px solid #D0D3D9;
          padding: 0 20px;
          z-index: 30;
          box-shadow: 6px 0 16px rgba(0,0,0,0.04);
          width: 160px;
        }

        .pf-box-name {
          font-family: 'Barlow Condensed', sans-serif;
          font-weight: 700;
          font-size: 15px;
          color: #2C3140;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .pf-box-size {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 9px;
          color: #A8ADBA;
          margin-top: 3px;
        }

        .pf-cell-grid {
          border-right: 1px solid #E2E4E8;
          transition: background 0.1s;
          cursor: pointer;
          flex: 1;
        }
        .pf-cell-grid:hover { background: rgba(240,180,41,0.06); }
        .pf-cell-today { background: rgba(240,180,41,0.04); }

        /* ── RESERVATION BARS ── */
        .draggable-reservation {
          background: #F0B429 !important;
          color: #1A1200 !important;
          border: none !important;
          border-radius: 7px !important;
          box-shadow: 0 2px 12px rgba(240,180,41,0.3) !important;
          font-family: 'Barlow Condensed', sans-serif !important;
          font-weight: 800 !important;
          font-size: 12px !important;
          letter-spacing: 0.07em !important;
          text-transform: uppercase !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          overflow: hidden !important;
          transition: background 0.1s, box-shadow 0.1s !important;
        }
        .draggable-reservation:hover {
          background: #E8A812 !important;
          box-shadow: 0 4px 20px rgba(240,180,41,0.45) !important;
        }
        .draggable-reservation.is-search-match {
          background: #2C3140 !important;
          color: #F0B429 !important;
          box-shadow: 0 2px 16px rgba(44,49,64,0.25) !important;
        }
        .draggable-reservation.is-search-match:hover {
          background: #3A4054 !important;
        }
        .draggable-reservation.is-search-dimmed {
          opacity: 0.2 !important;
        }

        /* ── MODALS ── */
        .pf-overlay {
          background: rgba(30,34,42,0.45);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }

        .pf-modal {
          background: #F4F5F7;
          border: 1px solid #D0D3D9;
          border-radius: 22px;
          box-shadow: 0 40px 80px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.6) inset;
        }

        .pf-modal-title {
          font-family: 'Barlow Condensed', sans-serif;
          font-weight: 800;
          font-size: 28px;
          color: #1F2228;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          line-height: 1;
        }

        .pf-modal-sub {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 9px;
          color: #A8ADBA;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          margin-top: 6px;
        }

        .pf-close-btn {
          width: 38px; height: 38px;
          background: #ECEEF1;
          border: 1px solid #D0D3D9;
          border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          color: #8A8F9C;
          transition: all 0.15s;
          flex-shrink: 0;
        }
        .pf-close-btn:hover { background: #E2E4E8; color: #1F2228; }

        .pf-label {
          font-family: 'Barlow Condensed', sans-serif;
          font-weight: 700;
          font-size: 10px;
          color: #9BA0AD;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          display: block;
          margin-bottom: 8px;
        }

        .pf-input {
          width: 100%;
          height: 50px;
          background: #ECEEF1;
          border: 1px solid #D0D3D9;
          border-radius: 11px;
          color: #1F2228;
          font-family: 'Barlow Condensed', sans-serif;
          font-weight: 600;
          font-size: 16px;
          padding: 0 18px 0 46px;
          outline: none;
          transition: all 0.15s;
          appearance: none;
          -webkit-appearance: none;
        }
        .pf-input::placeholder { color: #B8BDCA; }
        .pf-input:focus {
          border-color: #F0B429;
          box-shadow: 0 0 0 3px rgba(240,180,41,0.12);
          background: #fff;
        }

        .pf-input-mono {
          font-family: 'IBM Plex Mono', monospace;
          font-weight: 500;
          font-size: 13px;
          padding-left: 18px;
          color-scheme: light;
        }

        .pf-save-btn {
          width: 100%;
          height: 54px;
          margin-top: 32px;
          background: #F0B429;
          color: #fff;
          border: none;
          border-radius: 13px;
          font-family: 'Barlow Condensed', sans-serif;
          font-weight: 800;
          font-size: 16px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          transition: all 0.15s;
          box-shadow: 0 8px 28px rgba(240,180,41,0.28);
        }
        .pf-save-btn:hover {
          background: #E8A812;
          box-shadow: 0 16px 40px rgba(240,180,41,0.38);
          transform: translateY(-2px);
        }
        .pf-save-btn:active { transform: translateY(0); }

        .pf-search-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }
        .pf-search-input {
          height: 42px;
          width: 220px;
          background: #ECEEF1;
          border: 1px solid #D0D3D9;
          border-radius: 10px;
          font-family: 'Barlow Condensed', sans-serif;
          font-weight: 600;
          font-size: 15px;
          color: #1F2228;
          padding: 0 16px 0 40px;
          outline: none;
          transition: all 0.15s;
          letter-spacing: 0.02em;
        }
        .pf-search-input::placeholder { color: #B0B5C0; font-weight: 500; }
        .pf-search-input:focus {
          border-color: #F0B429;
          box-shadow: 0 0 0 3px rgba(240,180,41,0.12);
          background: #fff;
          width: 260px;
        }
        .pf-search-clear {
          position: absolute;
          right: 10px;
          width: 20px; height: 20px;
          background: #C8CDDA;
          border: none;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          color: #fff;
          transition: background 0.12s;
        }
        .pf-search-clear:hover { background: #9BA0AD; }

        .pf-other-months-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 24px 12px;
          flex-wrap: wrap;
          flex-shrink: 0;
        }
        .pf-other-months-label {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          color: #9BA0AD;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .pf-month-chip {
          display: flex;
          align-items: center;
          gap: 6px;
          height: 30px;
          padding: 0 12px;
          background: #fff;
          border: 1px solid #D0D3D9;
          border-radius: 8px;
          font-family: 'Barlow Condensed', sans-serif;
          font-weight: 700;
          font-size: 13px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #3A3F4A;
          cursor: pointer;
          transition: all 0.15s;
        }
        .pf-month-chip:hover {
          background: #F0B429;
          border-color: #F0B429;
          color: #fff;
          box-shadow: 0 4px 12px rgba(240,180,41,0.3);
        }
        .pf-month-chip-count {
          background: rgba(240,180,41,0.15);
          color: #C8920A;
          border-radius: 5px;
          font-size: 11px;
          font-weight: 800;
          padding: 1px 6px;
          transition: all 0.15s;
        }
        .pf-month-chip:hover .pf-month-chip-count {
          background: rgba(255,255,255,0.25);
          color: #fff;
        }

        .pf-badge {
          font-family: 'Barlow Condensed', sans-serif;
          font-weight: 700;
          font-size: 11px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: #6B7180;
          background: #ECEEF1;
          border: 1px solid #D0D3D9;
          border-radius: 7px;
          padding: 5px 12px;
        }

        .pf-detail-client {
          font-family: 'Barlow Condensed', sans-serif;
          font-weight: 800;
          font-size: 26px;
          color: #1F2228;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          margin-bottom: 14px;
        }

        .pf-detail-dates {
          background: #ECEEF1;
          border: 1px solid #D0D3D9;
          border-radius: 12px;
          padding: 13px 16px;
          display: flex;
          align-items: center;
          gap: 10px;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          font-weight: 500;
          color: #6B7180;
        }

        .pf-date-sep { color: #C0C5D0; }

        .pf-edit-btn {
          flex: 1;
          height: 46px;
          background: #F0B429;
          color: #fff;
          border: none;
          border-radius: 10px;
          font-family: 'Barlow Condensed', sans-serif;
          font-weight: 700;
          font-size: 14px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all 0.15s;
          box-shadow: 0 4px 14px rgba(240,180,41,0.28);
        }
        .pf-edit-btn:hover { background: #E8A812; }

        .pf-delete-btn {
          width: 46px; height: 46px;
          background: rgba(239,68,68,0.06);
          border: 1px solid rgba(239,68,68,0.18);
          border-radius: 10px;
          color: #ef4444;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.15s;
        }
        .pf-delete-btn:hover { background: rgba(239,68,68,0.12); }
      `}</style>

      <div className="pf-root" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

        {/* ── HEADER ── */}
        <header className="pf-header">
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="pf-logo-mark">
              <span className="pf-logo-letter">P</span>
            </div>
            <div>
              <div className="pf-app-name">ParkFlow</div>
              <div className="pf-app-sub">Management System</div>
            </div>
          </div>

          {/* Month Navigator */}
          <div className="pf-nav-pill">
            <button className="pf-nav-btn" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
              <ChevronLeft size={15} />
            </button>
            <span className="pf-month-label">
              {format(currentMonth, 'MMMM yyyy', { locale: fr })}
            </span>
            <button className="pf-nav-btn" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
              <ChevronRight size={15} />
            </button>
          </div>

          {/* Search */}
          <div className="pf-search-wrap">
            <Search size={14} style={{ position: 'absolute', left: 13, color: '#A0A5AF', pointerEvents: 'none' }} />
            <input
              className="pf-search-input"
              placeholder="Rechercher un client…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="pf-search-clear" onClick={() => setSearchQuery("")}>
                <X size={10} />
              </button>
            )}
          </div>

          {/* New Reservation */}
          <button className="pf-btn-primary" onClick={() => { resetForm(); setIsCreateModalOpen(true); }}>
            <PlusCircle size={15} />
            Nouvelle réservation
          </button>
        </header>

        {/* ── AUTRES MOIS ── */}
        {otherMonthMatches.length > 0 && (
          <div className="pf-other-months-bar">
            <span className="pf-other-months-label">Aussi en&nbsp;:</span>
            {otherMonthMatches.map(({ monthDate, label, count }) => (
              <button
                key={label}
                className="pf-month-chip"
                onClick={() => setCurrentMonth(monthDate)}
              >
                {label}
                <span className="pf-month-chip-count">{count}</span>
              </button>
            ))}
          </div>
        )}

        {/* ── GANTT ── */}
        <main style={{ flex: 1, overflow: 'hidden', padding: '20px 24px 24px' }}>
          <div className="pf-gantt-wrap" style={{ height: '100%' }} ref={scrollContainerRef}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <thead className="pf-thead-sticky">
                <tr>
                  <th className="pf-th-label">Emplacement</th>
                  {monthDays.map(day => (
                    <th
                      key={day.toISOString()}
                      className={`pf-th-day${isSameDay(day, new Date()) ? ' today-col' : ''}`}
                    >
                      <span className="pf-day-abbr">{format(day, 'EEE', { locale: fr })}</span>
                      <span className={`pf-day-num${isSameDay(day, new Date()) ? ' is-today' : ''}`}>
                        {format(day, 'dd')}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parkings.map(p => (
                  <tr key={p.id} className="pf-tr">
                    <td className="pf-td-label">
  <div className="pf-box-name">
    {BOX_CONFIG[p.name]?.label || p.name}
  </div>
  {BOX_CONFIG[p.name] && (
    <div className="pf-box-size">{BOX_CONFIG[p.name].size}</div>
  )}
</td>
                    <td colSpan={monthDays.length} style={{ padding: 0, position: 'relative' }}>
                      {/* Clickable grid cells */}
                      <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
                        {monthDays.map(d => (
                          <div
                            key={d.toISOString()}
                            onClick={() => handleCellClick(p.id, d)}
                            className={`pf-cell-grid${isSameDay(d, new Date()) ? ' pf-cell-today' : ''}`}
                          />
                        ))}
                      </div>

                      {/* Reservation bars */}
                      <div style={{ position: 'relative', width: '100%', height: '100%', pointerEvents: 'none', padding: '0 3px' }}>
                        {reservations.filter(r => r.parking_id === p.id).map(r => {
                          const barStyle = (function () {
                            const rStart = parseISO(r.start_date);
                            const rEnd = parseISO(r.end_date);
                            const mStart = startOfMonth(currentMonth);
                            const mEnd = endOfMonth(currentMonth);
                            const total = monthDays.length;
                            // Pas d'overlap avec le mois affiché
                            if (isAfter(rStart, mEnd) || isBefore(rEnd, mStart)) return null;
                            // Position : centre du jour d'arrivée → centre du jour de départ
                            // Si la resa débute avant le mois, on part du bord gauche (0)
                            const startIdx = differenceInCalendarDays(rStart, mStart);
                            const endIdx   = differenceInCalendarDays(rEnd,   mStart);
                            const left  = startIdx < 0         ? 0 : (startIdx + 0.5) / total;
                            const right = endIdx   >= total    ? 1 : (endIdx   + 0.5) / total;
                            if (right <= left) return null;
                            return {
                              left:  `${left  * 100}%`,
                              width: `${(right - left) * 100}%`,
                            };
                          })();
                          if (!barStyle) return null;
                          return (
                            <div
                              key={r.id}
                              data-id={r.id}
                              style={{
                                ...barStyle,
                                padding: '4px 2px',
                                position: 'absolute',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                height: 38,
                                cursor: 'move',
                                zIndex: 20,
                                pointerEvents: 'auto',
                              }}
                              className={`draggable-reservation touch-none${
                                searchQuery
                                  ? r.client_name.toLowerCase().includes(searchQuery.toLowerCase())
                                    ? ' is-search-match'
                                    : ' is-search-dimmed'
                                  : ''
                              }`}
                              onClick={(e) => { e.stopPropagation(); if (!isDragging.current) setPopupReservation(r); }}
                              onMouseEnter={(e) => { if (!isDragging.current) setTooltip({ r, x: e.clientX, y: e.clientY }); }}
                              onMouseMove={(e) => { if (tooltip) setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null); }}
                              onMouseLeave={() => setTooltip(null)}
                            >
                              <span style={{ pointerEvents: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'none', paddingLeft: 10, paddingRight: 10 }}>
                                {r.client_name}
                              </span>
                              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize' }} />
                              <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize' }} />
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>

        {/* ── MODAL CRÉATION ── */}
        {isCreateModalOpen && (
          <div className="pf-overlay" style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24 }}>
            <div className="pf-modal" style={{ width: '100%', maxWidth: 420, padding: '32px 28px' }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
                <div>
                  <div className="pf-modal-title">{editingId ? 'Édition' : 'Réservation'}</div>
                  <div className="pf-modal-sub">Saisie opérationnelle</div>
                </div>
                <button className="pf-close-btn" onClick={() => setIsCreateModalOpen(false)}>
                  <X size={15} />
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {/* Client name */}
                <div>
                  <label className="pf-label">Nom du client</label>
                  <div style={{ position: 'relative' }}>
                    <User size={15} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: '#2E2E3A' }} />
                    <input autoFocus className="pf-input" placeholder="Entrer le nom..." value={clientName} onChange={e => setClientName(e.target.value)} />
                  </div>
                </div>

                {/* Emplacement */}
                <div>
  <label className="pf-label">Emplacement</label>
  <div style={{ position: 'relative' }}>
    <Car size={15} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: '#2E2E3A', zIndex: 1 }} />
    <select 
  value={selectedParking || ""} 
  onChange={(e) => setSelectedParking(e.target.value)} 
  className="pf-input pf-input-select" 
  style={{ paddingLeft: 46 }}
>
  {parkings
    .reduce((acc: any[], p) => {
      // On calcule le nom affiché (Box 9 au lieu de Box1, etc.)
      const config = BOX_CONFIG[p.name];
      const displayName = config ? config.label : p.name;
      
      // On ne l'ajoute que si ce nom n'est pas déjà dans la liste
      if (!acc.find(item => item.displayName === displayName)) {
        acc.push({ ...p, displayName, displaySize: config ? ` — ${config.size}` : '' });
      }
      return acc;
    }, [])
    .map(p => (
      <option key={p.id} value={p.id}>
        {p.displayName}{p.displaySize}
      </option>
    ))
  }
</select>
  </div>
</div>

                {/* Dates */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="pf-label">Arrivée</label>
                    <input type="date" className="pf-input pf-input-mono" value={startDate} onChange={e => setStartDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="pf-label">Départ</label>
                    <input type="date" className="pf-input pf-input-mono" value={endDate} onChange={e => setEndDate(e.target.value)} />
                  </div>
                </div>
              </div>

              <button className="pf-save-btn" onClick={handleSave}>
                {editingId ? <Save size={17} /> : <PlusCircle size={17} />}
                {editingId ? 'Valider les modifications' : 'Confirmer la réservation'}
              </button>
            </div>
          </div>
        )}

        {/* ── MODAL DÉTAILS ── */}
        {popupReservation && (
          <div className="pf-overlay" style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24 }}>
            <div className="pf-modal" style={{ width: '100%', maxWidth: 320, padding: '26px 24px' }}>
              {/* Badge + close */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <span className="pf-badge">{parkings.find(p => p.id === popupReservation.parking_id)?.name}</span>
                <button className="pf-close-btn" onClick={() => setPopupReservation(null)}><X size={13} /></button>
              </div>

              {/* Client + dates */}
              <div style={{ marginBottom: 22 }}>
                <div className="pf-detail-client">{popupReservation.client_name}</div>
                <div className="pf-detail-dates">
                  <Clock size={12} style={{ color: '#333340', flexShrink: 0 }} />
                  <span>{format(parseISO(popupReservation.start_date), 'dd.MM.yy')}</span>
                  <span className="pf-date-sep">—</span>
                  <span>{format(parseISO(popupReservation.end_date), 'dd.MM.yy')}</span>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="pf-edit-btn" onClick={() => handleEditFromPopup(popupReservation)}>
                  <Edit2 size={13} /> Éditer
                </button>
                <button className="pf-delete-btn" onClick={() => handleDelete(popupReservation.id)}>
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── TOOLTIP SURVOL ── */}
        {tooltip && (
          <div style={{
            position: 'fixed',
            left: tooltip.x + 14,
            top: tooltip.y - 10,
            zIndex: 9999,
            pointerEvents: 'none',
            background: 'white',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
            padding: '8px 12px',
            minWidth: 180,
            maxWidth: 240,
          }}>
            <p style={{ fontWeight: 600, fontSize: 13, color: '#0f172a', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {tooltip.r.client_name}
            </p>
            <p style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>
              {parkings.find(p => p.id === tooltip.r.parking_id)?.name}
            </p>
            <p style={{ fontSize: 11, color: '#94a3b8' }}>
              {format(parseISO(tooltip.r.start_date), 'dd MMM', { locale: fr })}
              {' → '}
              {format(parseISO(tooltip.r.end_date), 'dd MMM yyyy', { locale: fr })}
            </p>
          </div>
        )}
      </div>
    </>
  );
}