import React, { useEffect, useState } from 'react';
import { DocumentFile, InvitePreview, RoomSummary, Source } from '../types';
import { roomsAPI, getErrorMessage } from '../services/api';
import { RoomView } from './RoomView';
import { Users, Plus, LogIn, Loader2, MessageCircle, Circle, FileText, X } from 'lucide-react';
import { PageHeader, Reveal } from '../motion';

interface RoomsProps {
  myDocuments: DocumentFile[];
  onOpenInReader: (source: Source) => void;
  /** Invite code from a /join/<code> link, handled once */
  inviteCode?: string | null;
  onInviteHandled?: () => void;
}

/** Accepts a raw code or a full invite link and returns the code. */
const parseInvite = (value: string) => {
  const trimmed = value.trim();
  const match = trimmed.match(/\/join\/([a-z0-9]+)/i);
  return (match ? match[1] : trimmed).toLowerCase();
};

const relative = (ms: number) => {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
};

export const Rooms: React.FC<RoomsProps> = ({ myDocuments, onOpenInReader, inviteCode, onInviteHandled }) => {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [openRoomId, setOpenRoomId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [joinValue, setJoinValue] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ code: string; preview: InvitePreview | null; error: string | null } | null>(null);

  const loadRooms = () => {
    roomsAPI.list().then(setRooms).catch(err => setError(getErrorMessage(err, 'Failed to load your rooms.')));
  };

  useEffect(() => {
    if (!openRoomId) loadRooms();
  }, [openRoomId]);

  // Opened from an invite link: preview the room before joining
  useEffect(() => {
    if (!inviteCode) return;
    const code = parseInvite(inviteCode);
    setInvite({ code, preview: null, error: null });
    roomsAPI.previewInvite(code)
      .then(preview => {
        if (preview.already_member) {
          setInvite(null);
          setOpenRoomId(preview.id);
        } else {
          setInvite({ code, preview, error: null });
        }
      })
      .catch(err => setInvite({ code, preview: null, error: getErrorMessage(err, 'This invite link is invalid.') }))
      .finally(() => onInviteHandled?.());
  }, [inviteCode]);

  const createRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy('create');
    setError(null);
    try {
      const room = await roomsAPI.create(newName.trim());
      setNewName('');
      setOpenRoomId(room.id);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not create the room.'));
    } finally {
      setBusy(null);
    }
  };

  const joinByCode = async (code: string) => {
    setBusy('join');
    setError(null);
    try {
      const room = await roomsAPI.join(code);
      setJoinValue('');
      setInvite(null);
      setOpenRoomId(room.id);
    } catch (err) {
      const message = getErrorMessage(err, 'Could not join the room.');
      if (invite) setInvite({ ...invite, error: message });
      else setError(message);
    } finally {
      setBusy(null);
    }
  };

  if (openRoomId) {
    return <RoomView roomId={openRoomId} myDocuments={myDocuments} onBack={() => setOpenRoomId(null)} onOpenInReader={onOpenInReader} />;
  }

  return (
    <div className="h-full overflow-y-auto">
    <div className="max-w-5xl mx-auto p-6 md:p-10 pb-20">
      <PageHeader
        className="mb-9"
        icon={<Users className="w-5 h-5 text-indigo-600" />}
        eyebrow="Live & together"
        tone="text-indigo-600"
        title="Study Rooms"
        accent={['Rooms']}
        subtitle="Study together in real time: chat with classmates, share documents, ask MindAI as a group and battle in live quizzes."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10 stagger">
        <form onSubmit={createRoom} className="spotlight lift bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <label htmlFor="new-room" className="block text-sm font-bold text-slate-700 mb-2">Create a room</label>
          <div className="flex gap-2">
            <input id="new-room" value={newName} onChange={e => setNewName(e.target.value)} maxLength={80} placeholder="e.g. Biology Finals Crew" className="flex-1 min-w-0 rounded-xl border-slate-200 bg-slate-50 py-2.5 focus:bg-white focus:border-indigo-500 focus:ring-indigo-500" />
            <button type="submit" disabled={!newName.trim() || busy === 'create'} className="btn-shine px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold disabled:opacity-40 flex items-center gap-1.5 shadow-md shadow-indigo-500/25">
              {busy === 'create' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create
            </button>
          </div>
        </form>
        <form onSubmit={e => { e.preventDefault(); if (joinValue.trim()) joinByCode(parseInvite(joinValue)); }} className="spotlight lift bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <label htmlFor="join-room" className="block text-sm font-bold text-slate-700 mb-2">Join with an invite</label>
          <div className="flex gap-2">
            <input id="join-room" value={joinValue} onChange={e => setJoinValue(e.target.value)} placeholder="Paste an invite link or code" className="flex-1 min-w-0 rounded-xl border-slate-200 bg-slate-50 py-2.5 focus:bg-white focus:border-indigo-500 focus:ring-indigo-500" />
            <button type="submit" disabled={!joinValue.trim() || busy === 'join'} className="btn-fill px-4 rounded-xl bg-slate-900 text-white font-bold disabled:opacity-40 flex items-center gap-1.5">
              {busy === 'join' ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />} Join
            </button>
          </div>
        </form>
      </div>
      {error && <p className="mb-6 text-sm text-rose-600 bg-rose-50 rounded-xl p-3 animate-slide-up">{error}</p>}

      <Reveal><h2 className="page-eyebrow text-slate-400 mb-4">Your rooms</h2></Reveal>
      {rooms === null ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-slate-300 animate-spin" /></div>
      ) : rooms.length === 0 ? (
        <div className="text-center py-14 bg-white/60 rounded-3xl border border-dashed border-slate-200 animate-rise">
          <MessageCircle className="w-10 h-10 text-slate-300 mx-auto mb-3 animate-float" />
          <p className="font-semibold text-slate-700">No rooms yet</p>
          <p className="text-sm text-slate-400 mt-1">Create one and share the invite link with your classmates.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 stagger">
          {rooms.map(room => (
            <li key={room.id}>
              <button onClick={() => setOpenRoomId(room.id)} data-cursor="Enter room" className="spotlight lift group w-full text-left bg-white rounded-2xl border border-slate-100 shadow-sm p-5 overflow-hidden">
                <div className="absolute -right-12 -top-12 w-36 h-36 rounded-full bg-gradient-to-br from-indigo-100 to-violet-100 opacity-0 group-hover:opacity-80 scale-50 group-hover:scale-100 transition-all duration-700 ease-out-expo pointer-events-none"></div>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h3 className="font-bold text-slate-900 truncate group-hover:text-indigo-700 transition-colors">{room.name}</h3>
                  {room.my_role === 'owner' && <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full flex-shrink-0">Owner</span>}
                </div>
                <p className="text-sm text-slate-500 truncate mb-3 min-h-[1.25rem]">
                  {room.last_message
                    ? `${room.last_message.user_name ? `${room.last_message.user_name}: ` : ''}${room.last_message.text}`
                    : 'No messages yet'}
                </p>
                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {room.member_count}</span>
                  <span className="flex items-center gap-1"><Circle className={`w-2.5 h-2.5 ${room.online_count ? 'fill-emerald-500 text-emerald-500' : ''}`} /> {room.online_count} online</span>
                  <span className="flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> {room.document_count}</span>
                  {room.last_message && <span className="ml-auto">{relative(room.last_message.created_at)}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Invite link dialog */}
      {invite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Join room">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm dialog-backdrop" onClick={() => setInvite(null)} />
          <div className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl p-7 text-center dialog-panel">
            <button onClick={() => setInvite(null)} className="absolute right-4 top-4 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Close"><X className="w-4 h-4" /></button>
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center mx-auto mb-4">
              <Users className="w-7 h-7" />
            </div>
            {invite.preview ? (
              <>
                <p className="text-sm text-slate-500">{invite.preview.owner_name} invited you to</p>
                <h2 className="text-2xl font-display font-bold text-slate-900 mt-1">{invite.preview.name}</h2>
                <p className="text-sm text-slate-400 mt-1 mb-6">{invite.preview.member_count} member{invite.preview.member_count === 1 ? '' : 's'}</p>
                {invite.error && <p className="text-sm text-rose-600 mb-3">{invite.error}</p>}
                <button onClick={() => joinByCode(invite.code)} disabled={busy === 'join'} className="w-full py-3 rounded-xl bg-indigo-600 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-60">
                  {busy === 'join' && <Loader2 className="w-4 h-4 animate-spin" />} Join room
                </button>
              </>
            ) : invite.error ? (
              <>
                <p className="font-semibold text-slate-800">{invite.error}</p>
                <p className="text-sm text-slate-500 mt-1">Ask whoever invited you for a new link.</p>
              </>
            ) : (
              <Loader2 className="w-6 h-6 text-slate-300 animate-spin mx-auto" />
            )}
          </div>
        </div>
      )}
    </div>
    </div>
  );
};
