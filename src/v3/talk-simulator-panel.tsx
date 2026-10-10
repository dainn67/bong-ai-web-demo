/**
 * Free Talk V3 Simulator Panel (Phase 6 W3.2 / B3.1 / B3.3 / B3.6).
 * Interactive web simulator for multi-turn voice/text talk with child safety guardrail,
 * curiosity topic extraction, spaced repetition review slots, and today memory.
 */

import React, { useState, useRef, useEffect } from 'react';

interface TalkMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  branch?: string;
  topic?: string;
  audioBase64?: string;
  timestamp: string;
}

interface TalkSessionState {
  sessionId: string | null;
  turnsLeft: number;
  ttsLeftSec: number;
  currentBranch: string | null;
  currentTopic: string | null;
  todaySummary: string;
  reviewSlots: {
    review_1?: string;
    review_2?: string;
    review_3?: string;
  };
}

export const TalkSimulatorPanel: React.FC = () => {
  const [deviceId, setDeviceId] = useState<string>('BONG_DEMO_001');
  const [backendUrl, setBackendUrl] = useState<string>(
    import.meta.env.VITE_BACKEND_API_URL || (typeof window !== 'undefined' ? window.location.origin : '')
  );
  const [session, setSession] = useState<TalkSessionState>({
    sessionId: null,
    turnsLeft: 0,
    ttsLeftSec: 0,
    currentBranch: null,
    currentTopic: null,
    todaySummary: '',
    reviewSlots: {},
  });
  const [messages, setMessages] = useState<TalkMessage[]>([]);
  const [inputText, setInputText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(true);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addMessage = (msg: Omit<TalkMessage, 'id' | 'timestamp'>) => {
    const timestamp = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setMessages((prev) => [
      ...prev,
      {
        ...msg,
        id: `msg_${prev.length + 1}`,
        timestamp,
      },
    ]);

    if (msg.audioBase64 && audioEnabled) {
      playAudioBase64(msg.audioBase64);
    }
  };

  const playAudioBase64 = (base64: string) => {
    try {
      const snd = new Audio(`data:audio/wav;base64,${base64}`);
      snd.play().catch((err) => console.warn('Audio autoplay prevented:', err));
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  };

  const handleStartTalk = async () => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('device_id', deviceId);
      formData.append('scene', 'scene_free_talk');
      formData.append('step', 'step_1');
      formData.append('voice', 'Chị HN');
      formData.append('prompt', 'Chào bé! Hôm nay ở trường hay ở nhà có điều gì vui kể cho Bống nghe với?');
      formData.append('seed', '');
      formData.append('turns', '5');
      formData.append('sec', '90');

      const res = await fetch(`${backendUrl}/api/v1/device/talk/start`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`Lỗi kết nối Talk API (${res.status})`);
      }

      const data = await res.json();
      const sessionId = data.session || data.session_id;
      setSession({
        sessionId,
        turnsLeft: 5,
        ttsLeftSec: data.tts_left > 0 ? data.tts_left : 90,
        currentBranch: data.branch || 'continue',
        currentTopic: data.topic || null,
        todaySummary: data.today_memory || '',
        reviewSlots: data.review_slots || {},
      });

      setMessages([
        {
          id: 'init',
          role: 'system',
          text: `Phiên đàm thoại đã bắt đầu (Mã phiên: ${sessionId ? sessionId.slice(0, 8) : '...'}...)`,
          timestamp: new Date().toLocaleTimeString('vi-VN'),
        },
      ]);

      addMessage({
        role: 'assistant',
        text: data.topic ? `[Chủ đề: ${data.topic}] Bống sẵn sàng lắng nghe câu chuyện của bé!` : 'Bống đang lắng nghe bé nói nè!',
        branch: data.branch,
        topic: data.topic,
        audioBase64: data.audio,
      });
    } catch (err: any) {
      addMessage({
        role: 'system',
        text: `⚠️ Lỗi: ${err.message}. Đảm bảo Backend API đang chạy tại ${backendUrl}.`,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSendTurn = async (childSpeech: string, audioBlob?: Blob) => {
    if (!session.sessionId) return;
    if (!childSpeech && !audioBlob) return;

    setLoading(true);
    const userText = childSpeech || '(Ghi âm giọng nói bé)';
    addMessage({
      role: 'user',
      text: userText,
    });
    setInputText('');

    try {
      const formData = new FormData();
      formData.append('session', session.sessionId);
      if (audioBlob) {
        formData.append('audio', audioBlob, 'child_speech.wav');
      }
      if (childSpeech) {
        formData.append('text', childSpeech);
        const dummyWav = new Uint8Array([
          0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
          0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
          0x80, 0x3e, 0x00, 0x00, 0x00, 0x7d, 0x00, 0x00, 0x02, 0x00, 0x10, 0x00,
          0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00,
        ]);
        formData.append('clip', new Blob([dummyWav], { type: 'audio/wav' }), 'clip.wav');
      }

      const res = await fetch(`${backendUrl}/api/v1/device/talk/turn`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`Turn thất bại (${res.status})`);
      }

      const data = await res.json();
      setSession((prev) => ({
        ...prev,
        turnsLeft: Math.max(0, prev.turnsLeft - 1),
        ttsLeftSec: data.tts_left > 0 ? data.tts_left : prev.ttsLeftSec,
        currentBranch: data.branch || prev.currentBranch,
        currentTopic: data.topic || prev.currentTopic,
      }));

      addMessage({
        role: 'assistant',
        text: data.topic ? `[${data.topic}] Bống trả lời:` : '(Bống mỉm cười và trả lời)',
        branch: data.branch,
        topic: data.topic,
        audioBase64: data.audio,
      });

      if (data.branch === 'limit') {
        addMessage({
          role: 'system',
          text: '⏳ Đã hết thời lượng hoặc số lượt đàm thoại hôm nay. Hẹn gặp lại bé ngày mai nhé!',
        });
      } else if (data.branch === 'safety') {
        addMessage({
          role: 'system',
          text: '🛡️ Bộ lọc an toàn trẻ em (Safety Guardrail) đã kích hoạt phản hồi sư phạm an toàn.',
        });
      }
    } catch (err: any) {
      addMessage({
        role: 'system',
        text: `⚠️ Lỗi xử lý lượt đàm thoại: ${err.message}`,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEndTalk = async () => {
    if (!session.sessionId) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('session', session.sessionId);
      await fetch(`${backendUrl}/api/v1/device/talk/end`, {
        method: 'POST',
        body: formData,
      });
      addMessage({
        role: 'system',
        text: 'Phiên đàm thoại đã kết thúc thành công.',
      });
      setSession((prev) => ({ ...prev, sessionId: null }));
    } catch (err: any) {
      console.warn('Lỗi khi kết thúc phiên:', err);
    } finally {
      setLoading(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        handleSendTurn('', audioBlob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      alert('Không thể truy cập Microphone trình duyệt. Bạn có thể gõ nội dung kiểm thử vào ô bên dưới nhé!');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(timerRef.current);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100 rounded-xl overflow-hidden border border-slate-800 shadow-2xl">
      {/* Header */}
      <div className="bg-slate-800/90 border-b border-slate-700 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🎙️</span>
          <div>
            <h2 className="text-base font-bold text-amber-400 flex items-center gap-2">
              Free Talk V3 Simulator (Giai Đoạn 3)
            </h2>
            <p className="text-xs text-slate-400">
              Đàm thoại tự do nhiều vòng, Bộ lọc an toàn 2 tầng, Ôn tập giãn cách
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <input
            type="text"
            value={backendUrl}
            onChange={(e) => setBackendUrl(e.target.value)}
            className="bg-slate-950 border border-slate-700 px-2 py-1 rounded text-slate-300 w-44 font-mono text-[11px]"
            placeholder="Backend API URL"
            title="Địa chỉ Backend API"
          />
          <input
            type="text"
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            className="bg-slate-950 border border-slate-700 px-2 py-1 rounded text-slate-300 w-32 font-mono text-[11px]"
            placeholder="Device ID"
          />
          <button
            onClick={() => setAudioEnabled(!audioEnabled)}
            className={`px-2.5 py-1 rounded border transition ${
              audioEnabled
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                : 'bg-slate-800 border-slate-700 text-slate-500'
            }`}
          >
            {audioEnabled ? '🔊 Loa bật' : '🔇 Loa tắt'}
          </button>
        </div>
      </div>

      {/* Dashboard Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 bg-slate-950/60 border-b border-slate-800 text-xs">
        <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
          <div className="text-slate-500">Mã Phiên</div>
          <div className="font-mono font-medium text-slate-200 truncate">
            {session.sessionId ? session.sessionId.slice(0, 10) + '...' : 'Chưa kết nối'}
          </div>
        </div>
        <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
          <div className="text-slate-500">Lượt Còn Lại</div>
          <div className="font-bold text-amber-400">
            {session.sessionId ? `${session.turnsLeft} turns` : '--'}
          </div>
        </div>
        <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
          <div className="text-slate-500">Thời Gian TTS</div>
          <div className="font-bold text-emerald-400">
            {session.sessionId ? `${session.ttsLeftSec}s` : '--'}
          </div>
        </div>
        <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
          <div className="text-slate-500">Nhánh / Chủ Đề</div>
          <div className="font-bold text-indigo-400 truncate">
            {session.currentBranch || 'none'}
            {session.currentTopic ? ` (${session.currentTopic})` : ''}
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-950/40">
        {messages.length === 0 && (
          <div className="text-center py-12 text-slate-500">
            <span className="text-4xl block mb-2">🧸</span>
            <p className="font-medium text-slate-400">Chưa có cuộc trò chuyện nào</p>
            <p className="text-xs mt-1 text-slate-500">
              Bấm nút &quot;Bắt Đầu Trò Chuyện&quot; bên dưới để Bống chào đón bé nhé!
            </p>
          </div>
        )}

        {messages.map((m) => {
          if (m.role === 'system') {
            return (
              <div key={m.id} className="text-center my-2">
                <span className="inline-block bg-slate-800/80 text-slate-400 text-xs px-3 py-1 rounded-full border border-slate-700">
                  {m.text}
                </span>
              </div>
            );
          }

          const isUser = m.role === 'user';
          return (
            <div
              key={m.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
            >
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mb-1 px-1">
                <span>{isUser ? 'Bé' : 'Bống'}</span>
                <span>•</span>
                <span>{m.timestamp}</span>
                {m.branch && (
                  <span
                    className={`ml-1 px-1.5 py-0.2 rounded font-mono uppercase text-[9px] ${
                      m.branch === 'safety'
                        ? 'bg-red-900/80 text-red-200 border border-red-700'
                        : m.branch === 'limit'
                        ? 'bg-amber-900/80 text-amber-200 border border-amber-700'
                        : 'bg-emerald-900/60 text-emerald-200'
                    }`}
                  >
                    {m.branch}
                  </span>
                )}
                {m.topic && (
                  <span className="bg-indigo-950 text-indigo-300 px-1.5 py-0.2 rounded border border-indigo-800 text-[9px]">
                    ✨ {m.topic}
                  </span>
                )}
              </div>

              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                  isUser
                    ? 'bg-amber-600 text-white rounded-br-none'
                    : 'bg-slate-800 text-slate-100 rounded-bl-none border border-slate-700'
                }`}
              >
                <p className="leading-relaxed">{m.text}</p>
                {m.audioBase64 && (
                  <button
                    onClick={() => playAudioBase64(m.audioBase64!)}
                    className="mt-2 text-xs flex items-center gap-1 text-amber-400 hover:text-amber-300 transition"
                  >
                    <span>▶️</span> Nghe lại âm thanh
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <div ref={chatBottomRef} />
      </div>

      {/* Preset Test Prompts for Fast Testing */}
      <div className="px-3 py-2 bg-slate-900 border-t border-slate-800 flex items-center gap-1.5 overflow-x-auto text-[11px] text-slate-400">
        <span className="shrink-0 text-slate-500">Mẫu thử:</span>
        <button
          onClick={() => setInputText('Bống ơi con mèo kêu meo meo đúng không?')}
          className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 shrink-0 text-slate-300"
        >
          🐱 Con mèo
        </button>
        <button
          onClick={() => setInputText('Vì sao mặt trăng lại sáng vào ban đêm hả Bống?')}
          className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 shrink-0 text-slate-300"
        >
          🌙 Tò mò mặt trăng
        </button>
        <button
          onClick={() => setInputText('Hôm nay con vừa học bài quả táo màu đỏ rất vui!')}
          className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 shrink-0 text-slate-300"
        >
          🍎 Ôn tập từ vựng
        </button>
        <button
          onClick={() => setInputText('Số điện thoại của mẹ là 0912345678 nè')}
          className="px-2 py-0.5 bg-red-950/60 hover:bg-red-900/80 rounded border border-red-800 shrink-0 text-red-300"
        >
          🛡️ Thử Safety (PII)
        </button>
        <button
          onClick={() => setInputText('silent')}
          className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 shrink-0 text-slate-300"
        >
          🤫 Bé im lặng
        </button>
      </div>

      {/* Control Actions / Inputs */}
      <div className="p-3 bg-slate-900 border-t border-slate-800 flex flex-col gap-2">
        {!session.sessionId ? (
          <button
            onClick={handleStartTalk}
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-lg shadow-md transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <span>✨</span> Bắt Đầu Trò Chuyện Tự Do (Talk Start)
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && inputText.trim()) {
                  handleSendTurn(inputText.trim());
                }
              }}
              placeholder="Nhập câu nói của bé hoặc bấm micro thu âm..."
              disabled={loading || isRecording}
              className="flex-1 bg-slate-950 border border-slate-700 px-3 py-2 text-sm rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />

            {!isRecording ? (
              <button
                onClick={startRecording}
                disabled={loading}
                className="p-2.5 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded-lg border border-slate-700 transition"
                title="Bấm để thu âm micro"
              >
                🎙️
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold animate-pulse text-xs flex items-center gap-1.5"
              >
                <span>⏹️ Dừng ({recordingSeconds}s)</span>
              </button>
            )}

            <button
              onClick={() => handleSendTurn(inputText.trim())}
              disabled={loading || !inputText.trim() || isRecording}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg transition disabled:opacity-50 text-sm"
            >
              Gửi
            </button>

            <button
              onClick={handleEndTalk}
              disabled={loading}
              className="px-3 py-2 bg-slate-800 hover:bg-red-950/60 text-slate-400 hover:text-red-300 border border-slate-700 hover:border-red-800 rounded-lg transition text-sm"
              title="Kết thúc phiên trò chuyện"
            >
              Kết thúc
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TalkSimulatorPanel;
