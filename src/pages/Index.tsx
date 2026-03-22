import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";
import Icon from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface User {
  id: number;
  username: string;
  display_name: string;
  avatar_color: string;
  status: string;
  custom_status?: string;
  email?: string;
}

interface Message {
  id: number;
  sender_id: number;
  sender_name: string;
  sender_color: string;
  content: string;
  created_at: string;
}

interface Conversation {
  id: number;
  type: string;
  name: string;
  avatar_color: string;
  other_user_status?: string;
  last_message?: string;
  last_time?: string;
  other_user_id?: number;
  group_id?: number;
}

interface Friend {
  id: number;
  username: string;
  display_name: string;
  avatar_color: string;
  status: string;
  friendship_status: string;
  is_requester: boolean;
}

type Tab = "friends" | "chat" | "call";

function Avatar({ color, name, size = 10 }: { color: string; name: string; size?: number }) {
  return (
    <div
      className={`w-${size} h-${size} rounded-full flex items-center justify-center flex-shrink-0 font-bold text-white`}
      style={{ backgroundColor: color }}
    >
      {name?.[0]?.toUpperCase() || "?"}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    online: "bg-green-500",
    offline: "bg-gray-500",
    busy: "bg-red-400",
    away: "bg-yellow-400",
  };
  return (
    <span className={`w-3 h-3 rounded-full border-2 border-[#1e1f22] ${colors[status] || "bg-gray-500"}`} />
  );
}

export default function Index() {
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [installed, setInstalled] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authForm, setAuthForm] = useState({ login: "", password: "", username: "", display_name: "", email: "" });
  const [authError, setAuthError] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<Tab>("friends");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgInput, setMsgInput] = useState("");
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendSearch, setFriendSearch] = useState("");
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [friendsTab, setFriendsTab] = useState<"all" | "pending" | "search">("all");
  const [groups, setGroups] = useState<{ id: number; name: string; avatar_color: string; member_count: number }[]>([]);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedFriendsForGroup, setSelectedFriendsForGroup] = useState<number[]>([]);
  const [showProfile, setShowProfile] = useState(false);
  const [profileEdit, setProfileEdit] = useState({ display_name: "", custom_status: "", status: "online" });
  const [showSettings, setShowSettings] = useState(false);

  // Call state
  const [inCall, setInCall] = useState(false);
  const [callConv, setCallConv] = useState<Conversation | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const msgEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", h);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  useEffect(() => {
    api.auth.me()
      .then((r) => {
        if (r.user) setUser(r.user);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const loadData = useCallback(async () => {
    const [convRes, friendRes, groupRes] = await Promise.all([
      api.messages.conversations(),
      api.friends.list(),
      api.groups.list(),
    ]);
    if (convRes.conversations) setConversations(convRes.conversations);
    if (friendRes.friends) setFriends(friendRes.friends);
    if (groupRes.groups) setGroups(groupRes.groups);
  }, []);

  useEffect(() => {
    if (user) loadData();
  }, [user, loadData]);

  const loadMessages = useCallback(async (convId: number) => {
    const r = await api.messages.getMessages(convId);
    if (r.messages) setMessages(r.messages);
  }, []);

  useEffect(() => {
    if (activeConv) {
      loadMessages(activeConv.id);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => loadMessages(activeConv.id), 3000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeConv, loadMessages]);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleAuth = async () => {
    setAuthError("");
    let r;
    if (authMode === "login") {
      r = await api.auth.login({ login: authForm.login, password: authForm.password });
    } else {
      r = await api.auth.register({
        username: authForm.username,
        display_name: authForm.display_name,
        email: authForm.email,
        password: authForm.password,
      });
    }
    if (r.error) { setAuthError(r.error); return; }
    localStorage.setItem("kiscord_session", r.session_id);
    setUser(r.user);
  };

  const handleLogout = async () => {
    await api.auth.logout();
    localStorage.removeItem("kiscord_session");
    setUser(null);
    setActiveConv(null);
    setMessages([]);
  };

  const sendMessage = async () => {
    if (!msgInput.trim() || !activeConv) return;
    const r = await api.messages.send(activeConv.id, msgInput.trim());
    if (r.message) {
      setMessages((prev) => [...prev, r.message]);
      setMsgInput("");
    }
  };

  const openDM = async (friendId: number) => {
    const r = await api.messages.openConversation({ user_id: friendId });
    if (r.conversation_id) {
      await loadData();
      const conv = conversations.find((c) => c.id === r.conversation_id) || {
        id: r.conversation_id,
        type: "direct",
        name: friends.find((f) => f.id === friendId)?.display_name || "Диалог",
        avatar_color: friends.find((f) => f.id === friendId)?.avatar_color || "#e06c75",
      };
      setActiveConv(conv as Conversation);
      setTab("chat");
    }
  };

  const searchFriends = async (q: string) => {
    setFriendSearch(q);
    if (q.length < 2) { setSearchResults([]); return; }
    const r = await api.friends.search(q);
    if (r.users) setSearchResults(r.users);
  };

  const startCall = async (conv: Conversation) => {
    setCallConv(conv);
    setInCall(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    } catch (e) { console.error(e); }
  };

  const endCall = () => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    if (peerRef.current) peerRef.current.close();
    localStreamRef.current = null;
    screenStreamRef.current = null;
    setInCall(false);
    setCallConv(null);
    setCameraOn(false);
    setScreenSharing(false);
    setMicOn(true);
  };

  const toggleMic = () => {
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !micOn));
    setMicOn((v) => !v);
  };

  const toggleCamera = async () => {
    if (!cameraOn) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        setCameraOn(true);
      } catch (e) { console.error(e); }
    } else {
      localStreamRef.current?.getVideoTracks().forEach((t) => t.stop());
      setCameraOn(false);
    }
  };

  const toggleScreen = async () => {
    if (!screenSharing) {
      try {
        const stream = await (navigator.mediaDevices as MediaDevices & { getDisplayMedia: (c?: object) => Promise<MediaStream> }).getDisplayMedia({ video: true });
        screenStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        setScreenSharing(true);
      } catch (e) { console.error(e); }
    } else {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      setScreenSharing(false);
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
    }
  };

  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    const r = await api.groups.create({ name: newGroupName, member_ids: selectedFriendsForGroup });
    if (r.group_id) {
      await loadData();
      setShowCreateGroup(false);
      setNewGroupName("");
      setSelectedFriendsForGroup([]);
    }
  };

  const saveProfile = async () => {
    await api.auth.updateProfile(profileEdit);
    const r = await api.auth.me();
    if (r.user) setUser(r.user);
    setShowProfile(false);
  };

  const handleInstall = async () => {
    if (installPrompt) {
      (installPrompt as BeforeInstallPromptEvent).prompt();
      const { outcome } = await (installPrompt as BeforeInstallPromptEvent).userChoice;
      if (outcome === "accepted") setInstalled(true);
      setInstallPrompt(null);
    }
  };

  const formatTime = (str: string) => {
    if (!str) return "";
    const d = new Date(str);
    return d.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
  };

  const acceptedFriends = friends.filter((f) => f.friendship_status === "accepted");
  const pendingFriends = friends.filter((f) => f.friendship_status === "pending" && !f.is_requester);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#1e1f22] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-[#c0424a] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // AUTH SCREEN
  if (!user) {
    return (
      <div className="min-h-screen bg-[#1e1f22] flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-[#c0424a] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Icon name="MessageCircle" size={32} className="text-white" />
            </div>
            <h1 className="text-3xl font-black text-white">Kiscord</h1>
            <p className="text-[#949ba4] text-sm mt-1">Мессенджер нового поколения</p>
          </div>

          <div className="bg-[#2b2d31] rounded-2xl p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-1">
              {authMode === "login" ? "Снова здесь!" : "Создай аккаунт"}
            </h2>
            <p className="text-[#949ba4] text-sm mb-6">
              {authMode === "login" ? "Рады видеть тебя снова" : "Давай начнём!"}
            </p>

            <div className="space-y-3">
              {authMode === "register" && (
                <>
                  <div>
                    <label className="text-[#b5bac1] text-xs font-semibold uppercase mb-1 block">Имя пользователя</label>
                    <Input
                      className="bg-[#1e1f22] border-none text-white placeholder:text-[#4e5058]"
                      placeholder="cooluser123"
                      value={authForm.username}
                      onChange={(e) => setAuthForm((p) => ({ ...p, username: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-[#b5bac1] text-xs font-semibold uppercase mb-1 block">Отображаемое имя</label>
                    <Input
                      className="bg-[#1e1f22] border-none text-white placeholder:text-[#4e5058]"
                      placeholder="Иван Иванов"
                      value={authForm.display_name}
                      onChange={(e) => setAuthForm((p) => ({ ...p, display_name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-[#b5bac1] text-xs font-semibold uppercase mb-1 block">Email</label>
                    <Input
                      className="bg-[#1e1f22] border-none text-white placeholder:text-[#4e5058]"
                      placeholder="email@example.com"
                      type="email"
                      value={authForm.email}
                      onChange={(e) => setAuthForm((p) => ({ ...p, email: e.target.value }))}
                    />
                  </div>
                </>
              )}
              {authMode === "login" && (
                <div>
                  <label className="text-[#b5bac1] text-xs font-semibold uppercase mb-1 block">Email или имя пользователя</label>
                  <Input
                    className="bg-[#1e1f22] border-none text-white placeholder:text-[#4e5058]"
                    placeholder="user или email@example.com"
                    value={authForm.login}
                    onChange={(e) => setAuthForm((p) => ({ ...p, login: e.target.value }))}
                  />
                </div>
              )}
              <div>
                <label className="text-[#b5bac1] text-xs font-semibold uppercase mb-1 block">Пароль</label>
                <Input
                  className="bg-[#1e1f22] border-none text-white placeholder:text-[#4e5058]"
                  type="password"
                  placeholder="••••••••"
                  value={authForm.password}
                  onChange={(e) => setAuthForm((p) => ({ ...p, password: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && handleAuth()}
                />
              </div>
            </div>

            {authError && <p className="text-red-400 text-sm mt-3">{authError}</p>}

            <Button
              className="w-full mt-5 bg-[#c0424a] hover:bg-[#a8373e] text-white font-semibold py-2.5"
              onClick={handleAuth}
            >
              {authMode === "login" ? "Войти" : "Зарегистрироваться"}
            </Button>

            <p className="text-center text-[#949ba4] text-sm mt-4">
              {authMode === "login" ? (
                <>Нет аккаунта?{" "}
                  <button className="text-[#c0424a] hover:underline font-medium" onClick={() => setAuthMode("register")}>Зарегистрироваться</button>
                </>
              ) : (
                <>Уже есть аккаунт?{" "}
                  <button className="text-[#c0424a] hover:underline font-medium" onClick={() => setAuthMode("login")}>Войти</button>
                </>
              )}
            </p>
          </div>

          {installPrompt && (
            <button onClick={handleInstall} className="mt-4 w-full text-center text-[#c0424a] text-sm hover:underline">
              {installed ? "Установлено ✓" : "Установить приложение"}
            </button>
          )}
        </div>
      </div>
    );
  }

  // CALL SCREEN
  if (inCall && callConv) {
    return (
      <div className="min-h-screen bg-[#111214] flex flex-col">
        <div className="flex-1 flex items-center justify-center relative">
          {(cameraOn || screenSharing) ? (
            <video ref={localVideoRef} autoPlay muted className="w-full h-full object-cover" />
          ) : (
            <div className="text-center">
              <Avatar color={callConv.avatar_color} name={callConv.name} size={24} />
              <h2 className="text-white text-2xl font-bold mt-4">{callConv.name}</h2>
              <p className="text-[#949ba4] mt-2 flex items-center gap-2 justify-center">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse inline-block" />
                Звонок активен
              </p>
            </div>
          )}
          {(cameraOn || screenSharing) && (
            <div className="absolute bottom-24 right-4 w-32 h-24 bg-[#2b2d31] rounded-lg overflow-hidden">
              <video ref={remoteVideoRef} autoPlay className="w-full h-full object-cover" />
            </div>
          )}
        </div>

        <div className="bg-[#1e1f22] border-t border-[#3f4147] p-4">
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <button
              onClick={toggleMic}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${micOn ? "bg-[#4e5058] hover:bg-[#6d6f78]" : "bg-[#c0424a] hover:bg-[#a8373e]"}`}
            >
              <Icon name={micOn ? "Mic" : "MicOff"} size={20} className="text-white" />
            </button>
            <button
              onClick={() => setSpeakerOn((v) => !v)}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${speakerOn ? "bg-[#4e5058] hover:bg-[#6d6f78]" : "bg-[#c0424a] hover:bg-[#a8373e]"}`}
            >
              <Icon name={speakerOn ? "Volume2" : "VolumeX"} size={20} className="text-white" />
            </button>
            <button
              onClick={toggleCamera}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${cameraOn ? "bg-[#c0424a]" : "bg-[#4e5058] hover:bg-[#6d6f78]"}`}
            >
              <Icon name={cameraOn ? "Video" : "VideoOff"} size={20} className="text-white" />
            </button>
            <button
              onClick={toggleScreen}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${screenSharing ? "bg-[#c0424a]" : "bg-[#4e5058] hover:bg-[#6d6f78]"}`}
            >
              <Icon name="Monitor" size={20} className="text-white" />
            </button>
            <button
              onClick={endCall}
              className="w-14 h-14 rounded-full bg-[#c0424a] hover:bg-[#a8373e] flex items-center justify-center transition-colors"
            >
              <Icon name="PhoneOff" size={24} className="text-white" />
            </button>
          </div>
          <p className="text-center text-[#949ba4] text-xs mt-3">
            {callConv.name} · {micOn ? "Микрофон включён" : "Микрофон выключен"} · {screenSharing ? "Трансляция экрана" : cameraOn ? "Камера включена" : ""}
          </p>
        </div>
      </div>
    );
  }

  // MAIN APP
  return (
    <div className="h-screen bg-[#313338] flex overflow-hidden text-white">
      {/* Servers sidebar */}
      <div className="w-[72px] bg-[#1e1f22] flex flex-col items-center py-3 gap-2 flex-shrink-0">
        <div
          className="w-12 h-12 bg-[#c0424a] rounded-2xl hover:rounded-xl transition-all duration-200 flex items-center justify-center cursor-pointer"
          title="Kiscord"
        >
          <Icon name="MessageCircle" size={24} className="text-white" />
        </div>
        <div className="w-8 h-[2px] bg-[#35373c] rounded-full" />
        {groups.map((g) => (
          <div
            key={g.id}
            title={g.name}
            className="w-12 h-12 rounded-3xl hover:rounded-xl transition-all duration-200 flex items-center justify-center cursor-pointer font-bold text-white text-lg"
            style={{ backgroundColor: g.avatar_color }}
            onClick={async () => {
              const r = await api.messages.openConversation({ group_id: g.id });
              if (r.conversation_id) {
                await loadData();
                setActiveConv({ id: r.conversation_id, type: "group", name: g.name, avatar_color: g.avatar_color });
                setTab("chat");
              }
            }}
          >
            {g.name[0].toUpperCase()}
          </div>
        ))}
        <button
          className="w-12 h-12 bg-[#2b2d31] hover:bg-[#3ba55c] rounded-3xl hover:rounded-xl transition-all duration-200 flex items-center justify-center cursor-pointer group"
          title="Создать группу"
          onClick={() => setShowCreateGroup(true)}
        >
          <Icon name="Plus" size={20} className="text-[#3ba55c] group-hover:text-white" />
        </button>
      </div>

      {/* Channels/DMs sidebar */}
      <div className="w-60 bg-[#2b2d31] flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-[#1e1f22] shadow-sm">
          <h2 className="text-white font-semibold text-base truncate">
            {tab === "chat" && activeConv?.type === "group" ? activeConv.name : "Личные сообщения"}
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <div className="px-2 py-1">
            <p className="text-[#949ba4] text-xs font-semibold uppercase tracking-wide mb-1">Прямые сообщения</p>
          </div>
          {conversations.filter((c) => c.type === "direct").map((conv) => (
            <button
              key={conv.id}
              onClick={() => { setActiveConv(conv); setTab("chat"); }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${activeConv?.id === conv.id ? "bg-[#404249] text-white" : "text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1]"}`}
            >
              <div className="relative">
                <Avatar color={conv.avatar_color} name={conv.name} size={8} />
                <div className="absolute -bottom-0.5 -right-0.5">
                  <StatusDot status={conv.other_user_status || "offline"} />
                </div>
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-medium truncate">{conv.name}</p>
                {conv.last_message && <p className="text-xs truncate opacity-70">{conv.last_message}</p>}
              </div>
            </button>
          ))}

          {conversations.filter((c) => c.type === "group").length > 0 && (
            <>
              <div className="px-2 py-1 mt-2">
                <p className="text-[#949ba4] text-xs font-semibold uppercase tracking-wide mb-1">Группы</p>
              </div>
              {conversations.filter((c) => c.type === "group").map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => { setActiveConv(conv); setTab("chat"); }}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${activeConv?.id === conv.id ? "bg-[#404249] text-white" : "text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1]"}`}
                >
                  <Avatar color={conv.avatar_color} name={conv.name} size={8} />
                  <span className="text-sm font-medium truncate">{conv.name}</span>
                </button>
              ))}
            </>
          )}
        </div>

        {/* User panel */}
        <div className="p-2 bg-[#232428] flex items-center gap-2">
          <div className="relative cursor-pointer" onClick={() => { setProfileEdit({ display_name: user.display_name, custom_status: user.custom_status || "", status: user.status }); setShowProfile(true); }}>
            <Avatar color={user.avatar_color} name={user.display_name} size={8} />
            <div className="absolute -bottom-0.5 -right-0.5"><StatusDot status={user.status} /></div>
          </div>
          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { setProfileEdit({ display_name: user.display_name, custom_status: user.custom_status || "", status: user.status }); setShowProfile(true); }}>
            <p className="text-white text-sm font-medium truncate">{user.display_name}</p>
            <p className="text-[#949ba4] text-xs truncate">{user.custom_status || `@${user.username}`}</p>
          </div>
          <div className="flex gap-1">
            <button className="w-8 h-8 flex items-center justify-center rounded hover:bg-[#35373c] text-[#949ba4] hover:text-[#dbdee1]" onClick={() => setShowSettings(true)}>
              <Icon name="Settings" size={16} />
            </button>
            <button className="w-8 h-8 flex items-center justify-center rounded hover:bg-[#35373c] text-[#949ba4] hover:text-[#dbdee1]" onClick={handleLogout}>
              <Icon name="LogOut" size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="h-12 bg-[#313338] border-b border-[#1e1f22] flex items-center px-4 gap-3 flex-shrink-0">
          {tab === "chat" && activeConv ? (
            <>
              {activeConv.type === "direct" ? (
                <Icon name="AtSign" size={20} className="text-[#949ba4]" />
              ) : (
                <Icon name="Hash" size={20} className="text-[#949ba4]" />
              )}
              <span className="font-semibold text-white">{activeConv.name}</span>
              <div className="ml-auto flex items-center gap-3">
                <button
                  className="text-[#949ba4] hover:text-[#dbdee1] transition-colors"
                  title="Голосовой звонок"
                  onClick={() => startCall(activeConv)}
                >
                  <Icon name="Phone" size={20} />
                </button>
                <button
                  className="text-[#949ba4] hover:text-[#dbdee1] transition-colors"
                  title="Видеозвонок"
                  onClick={() => { setCameraOn(true); startCall(activeConv); }}
                >
                  <Icon name="Video" size={20} />
                </button>
              </div>
            </>
          ) : (
            <>
              <Icon name="Users" size={20} className="text-[#949ba4]" />
              <span className="font-semibold text-white">Друзья</span>
              <div className="ml-4 flex gap-1">
                {(["all", "pending", "search"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setFriendsTab(t)}
                    className={`px-3 py-1 rounded text-sm font-medium transition-colors ${friendsTab === t ? "bg-[#404249] text-white" : "text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1]"}`}
                  >
                    {t === "all" ? "Все" : t === "pending" ? `Ожидают ${pendingFriends.length > 0 ? `(${pendingFriends.length})` : ""}` : "Добавить"}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Content */}
        {tab === "chat" && activeConv ? (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
              {messages.length === 0 && (
                <div className="text-center py-12">
                  <div className="w-16 h-16 mx-auto mb-4">
                    <Avatar color={activeConv.avatar_color} name={activeConv.name} size={16} />
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-2">{activeConv.name}</h3>
                  <p className="text-[#949ba4]">Начало диалога с {activeConv.name}</p>
                </div>
              )}
              {messages.map((msg, i) => {
                const prev = messages[i - 1];
                const grouped = prev && prev.sender_id === msg.sender_id;
                return (
                  <div key={msg.id} className={`flex gap-4 ${grouped ? "mt-0.5" : "mt-4"} group hover:bg-[#2e3035] px-2 py-0.5 rounded`}>
                    <div className="w-10 flex-shrink-0">
                      {!grouped && <Avatar color={msg.sender_color || "#c0424a"} name={msg.sender_name || "?"} size={10} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      {!grouped && (
                        <div className="flex items-baseline gap-2 mb-0.5">
                          <span className="text-white font-medium text-sm">{msg.sender_name}</span>
                          <span className="text-[#4e5058] text-xs">{formatTime(msg.created_at)}</span>
                        </div>
                      )}
                      <p className="text-[#dbdee1] text-sm leading-relaxed break-words">{msg.content}</p>
                    </div>
                  </div>
                );
              })}
              <div ref={msgEndRef} />
            </div>
            <div className="px-4 pb-4 flex-shrink-0">
              <div className="bg-[#383a40] rounded-lg flex items-center gap-2 px-4 py-2">
                <input
                  className="flex-1 bg-transparent text-[#dbdee1] placeholder:text-[#4e5058] outline-none text-sm"
                  placeholder={`Написать @${activeConv.name}`}
                  value={msgInput}
                  onChange={(e) => setMsgInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                />
                <button onClick={sendMessage} className="text-[#949ba4] hover:text-white transition-colors">
                  <Icon name="Send" size={18} />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            {friendsTab === "all" && (
              <div>
                <p className="text-[#949ba4] text-xs font-semibold uppercase tracking-wide mb-3">
                  В сети — {acceptedFriends.filter((f) => f.status === "online").length}
                </p>
                {acceptedFriends.length === 0 && (
                  <div className="text-center py-12">
                    <Icon name="UserX" size={48} className="text-[#4e5058] mx-auto mb-3" />
                    <p className="text-[#949ba4]">У тебя пока нет друзей. Найди их во вкладке «Добавить»!</p>
                  </div>
                )}
                {acceptedFriends.map((f) => (
                  <div key={f.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#35373c] group">
                    <div className="relative">
                      <Avatar color={f.avatar_color} name={f.display_name} size={10} />
                      <div className="absolute -bottom-0.5 -right-0.5"><StatusDot status={f.status} /></div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium text-sm">{f.display_name}</p>
                      <p className="text-[#949ba4] text-xs">@{f.username} · {f.status === "online" ? "В сети" : "Не в сети"}</p>
                    </div>
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="w-8 h-8 bg-[#383a40] rounded-full flex items-center justify-center hover:bg-[#c0424a] text-[#949ba4] hover:text-white transition-colors"
                        title="Написать"
                        onClick={() => openDM(f.id)}
                      >
                        <Icon name="MessageCircle" size={16} />
                      </button>
                      <button
                        className="w-8 h-8 bg-[#383a40] rounded-full flex items-center justify-center hover:bg-[#c0424a] text-[#949ba4] hover:text-white transition-colors"
                        title="Позвонить"
                        onClick={() => { openDM(f.id).then(() => activeConv && startCall(activeConv)); }}
                      >
                        <Icon name="Phone" size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {friendsTab === "pending" && (
              <div>
                <p className="text-[#949ba4] text-xs font-semibold uppercase tracking-wide mb-3">
                  Входящие — {pendingFriends.length}
                </p>
                {pendingFriends.length === 0 && (
                  <div className="text-center py-12">
                    <Icon name="Bell" size={48} className="text-[#4e5058] mx-auto mb-3" />
                    <p className="text-[#949ba4]">Нет входящих заявок в друзья</p>
                  </div>
                )}
                {pendingFriends.map((f) => (
                  <div key={f.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#35373c]">
                    <Avatar color={f.avatar_color} name={f.display_name} size={10} />
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium text-sm">{f.display_name}</p>
                      <p className="text-[#949ba4] text-xs">Входящая заявка</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="w-8 h-8 bg-[#383a40] rounded-full flex items-center justify-center hover:bg-[#3ba55c] text-[#949ba4] hover:text-white transition-colors"
                        onClick={() => { api.friends.accept(f.id).then(loadData); }}
                      >
                        <Icon name="Check" size={16} />
                      </button>
                      <button
                        className="w-8 h-8 bg-[#383a40] rounded-full flex items-center justify-center hover:bg-[#c0424a] text-[#949ba4] hover:text-white transition-colors"
                        onClick={() => { api.friends.decline(f.id).then(loadData); }}
                      >
                        <Icon name="X" size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {friendsTab === "search" && (
              <div>
                <div className="mb-4">
                  <p className="text-[#b5bac1] text-xs font-semibold uppercase mb-2">Добавить друга</p>
                  <div className="bg-[#1e1f22] rounded-lg flex items-center px-3 py-2 gap-2">
                    <Icon name="Search" size={16} className="text-[#4e5058]" />
                    <input
                      className="flex-1 bg-transparent text-white placeholder:text-[#4e5058] outline-none text-sm"
                      placeholder="Поиск по имени или нику..."
                      value={friendSearch}
                      onChange={(e) => searchFriends(e.target.value)}
                    />
                  </div>
                </div>
                {searchResults.map((u) => {
                  const existing = friends.find((f) => f.id === u.id);
                  return (
                    <div key={u.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#35373c]">
                      <Avatar color={u.avatar_color} name={u.display_name} size={10} />
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-medium text-sm">{u.display_name}</p>
                        <p className="text-[#949ba4] text-xs">@{u.username}</p>
                      </div>
                      {!existing ? (
                        <button
                          className="px-3 py-1 bg-[#c0424a] hover:bg-[#a8373e] text-white text-sm rounded-md transition-colors"
                          onClick={() => { api.friends.request(u.id).then(loadData); }}
                        >
                          Добавить
                        </button>
                      ) : (
                        <span className="text-[#949ba4] text-xs">
                          {existing.friendship_status === "accepted" ? "Друг" : existing.friendship_status === "pending" ? "Запрос отправлен" : ""}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Profile modal */}
      {showProfile && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowProfile(false)}>
          <div className="bg-[#2b2d31] rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-4">Редактировать профиль</h3>
            <div className="flex justify-center mb-4">
              <Avatar color={user.avatar_color} name={user.display_name} size={20} />
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[#b5bac1] text-xs font-semibold uppercase block mb-1">Отображаемое имя</label>
                <Input className="bg-[#1e1f22] border-none text-white" value={profileEdit.display_name} onChange={(e) => setProfileEdit((p) => ({ ...p, display_name: e.target.value }))} />
              </div>
              <div>
                <label className="text-[#b5bac1] text-xs font-semibold uppercase block mb-1">Статус</label>
                <Input className="bg-[#1e1f22] border-none text-white" placeholder="Что ты делаешь?" value={profileEdit.custom_status} onChange={(e) => setProfileEdit((p) => ({ ...p, custom_status: e.target.value }))} />
              </div>
              <div>
                <label className="text-[#b5bac1] text-xs font-semibold uppercase block mb-1">Присутствие</label>
                <select
                  className="w-full bg-[#1e1f22] text-white rounded-md px-3 py-2 text-sm outline-none"
                  value={profileEdit.status}
                  onChange={(e) => setProfileEdit((p) => ({ ...p, status: e.target.value }))}
                >
                  <option value="online">В сети</option>
                  <option value="away">Отошёл</option>
                  <option value="busy">Не беспокоить</option>
                  <option value="offline">Невидимый</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <Button variant="ghost" className="flex-1 text-[#949ba4] hover:text-white" onClick={() => setShowProfile(false)}>Отмена</Button>
              <Button className="flex-1 bg-[#c0424a] hover:bg-[#a8373e] text-white" onClick={saveProfile}>Сохранить</Button>
            </div>
          </div>
        </div>
      )}

      {/* Settings modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowSettings(false)}>
          <div className="bg-[#2b2d31] rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Icon name="Settings" size={20} className="text-[#c0424a]" />
              Настройки
            </h3>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#35373c] cursor-pointer" onClick={() => { setShowSettings(false); setProfileEdit({ display_name: user.display_name, custom_status: user.custom_status || "", status: user.status }); setShowProfile(true); }}>
                <Icon name="User" size={16} className="text-[#949ba4]" />
                <span className="text-[#dbdee1]">Профиль</span>
              </div>
              <div className="px-3 py-2.5 rounded-lg">
                <div className="flex items-center gap-3 mb-1">
                  <Icon name="Mic" size={16} className="text-[#949ba4]" />
                  <span className="text-[#dbdee1]">Голос и видео</span>
                </div>
                <p className="text-[#4e5058] text-xs ml-7">Настройки микрофона и камеры доступны во время звонка</p>
              </div>
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#35373c] cursor-pointer">
                <Icon name="Bell" size={16} className="text-[#949ba4]" />
                <span className="text-[#dbdee1]">Уведомления</span>
              </div>
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#35373c] cursor-pointer" onClick={() => { if (installPrompt) handleInstall(); }}>
                <Icon name="Download" size={16} className="text-[#949ba4]" />
                <span className="text-[#dbdee1]">{installed ? "Приложение установлено ✓" : "Установить приложение"}</span>
              </div>
              <div className="border-t border-[#1e1f22] my-2" />
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#c0424a]/20 cursor-pointer text-[#c0424a]" onClick={handleLogout}>
                <Icon name="LogOut" size={16} />
                <span>Выйти</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create group modal */}
      {showCreateGroup && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowCreateGroup(false)}>
          <div className="bg-[#2b2d31] rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-4">Создать группу</h3>
            <Input
              className="bg-[#1e1f22] border-none text-white mb-4"
              placeholder="Название группы"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
            />
            {acceptedFriends.length > 0 && (
              <div>
                <p className="text-[#b5bac1] text-xs font-semibold uppercase mb-2">Добавить друзей</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {acceptedFriends.map((f) => (
                    <div
                      key={f.id}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${selectedFriendsForGroup.includes(f.id) ? "bg-[#c0424a]/20" : "hover:bg-[#35373c]"}`}
                      onClick={() => setSelectedFriendsForGroup((prev) => prev.includes(f.id) ? prev.filter((id) => id !== f.id) : [...prev, f.id])}
                    >
                      <Avatar color={f.avatar_color} name={f.display_name} size={8} />
                      <span className="text-white text-sm flex-1">{f.display_name}</span>
                      {selectedFriendsForGroup.includes(f.id) && <Icon name="Check" size={16} className="text-[#c0424a]" />}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-3 mt-5">
              <Button variant="ghost" className="flex-1 text-[#949ba4] hover:text-white" onClick={() => setShowCreateGroup(false)}>Отмена</Button>
              <Button className="flex-1 bg-[#c0424a] hover:bg-[#a8373e] text-white" onClick={createGroup}>Создать</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}