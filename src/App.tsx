import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Key,
  CornerDownLeft,
  X,
  Zap,
  Scissors,
  Wand2,
  Languages,
  HelpCircle,
  Camera,
  Layers,
  RotateCcw,
  Copy,
  Check,
  Bot,
  User,
  Mic,
  MicOff,
  Loader2,
} from "lucide-react";

interface Persona {
  id: string;
  name: string;
  prompt: string;
}

const PERSONAS: Persona[] = [
  {
    id: "coder",
    name: "Coder",
    prompt:
      "You are a helpful coding assistant. Keep explanations concise and provide clean code examples.",
  },
  {
    id: "writer",
    name: "Writer",
    prompt:
      "You are a skilled creative writer and editor. Improve phrasing, maintain tone, and polish prose.",
  },
  {
    id: "concise",
    name: "Concise",
    prompt:
      "Provide direct, extremely brief answers without unnecessary filler.",
  },
];

interface ChatMsg {
  role: "user" | "assistant";
  text: string;
}

export default function App() {
  const [inputApiKey, setInputApiKey] = useState<string>("");
  const [isKeyConfigured, setIsKeyConfigured] = useState<boolean>(false);
  const [inputPrompt, setInputPrompt] = useState<string>("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [currentResponse, setCurrentResponse] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedPersona, setSelectedPersona] = useState<Persona>(PERSONAS[0]);
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Audio / Dictation state
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const isRecordingRef = useRef<boolean>(false);
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  const responseEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Fetch initial API key state
    invoke<string | null>("get_api_key")
      .then((key) => {
        if (key) {
          setIsKeyConfigured(true);
        }
      })
      .catch((err) => console.error("Failed to load API key:", err));

    // Listen to AI events from Tauri backend
    const unlistenChunk = listen<{ text: string }>("ai-chunk", (event) => {
      setCurrentResponse((prev) => prev + event.payload.text);
    });

    const unlistenDone = listen("ai-done", () => {
      setCurrentResponse((fullResponse) => {
        if (fullResponse) {
          setMessages((prev) => [...prev, { role: "assistant", text: fullResponse }]);
        }
        return "";
      });
      setIsLoading(false);
    });

    const unlistenError = listen<{ error: string }>("ai-error", (event) => {
      setErrorMessage(event.payload.error);
      setIsLoading(false);
    });

    // Listen to global shortcut dictation toggle
    const unlistenDictation = listen("toggle-dictation", () => {
      handleToggleRecording();
    });

    return () => {
      unlistenChunk.then((f) => f());
      unlistenDone.then((f) => f());
      unlistenError.then((f) => f());
      unlistenDictation.then((f) => f());
    };
  }, []);

  useEffect(() => {
    responseEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentResponse]);

  const handleSaveApiKey = async () => {
    if (!inputApiKey.trim()) return;
    try {
      await invoke("save_api_key", { key: inputApiKey.trim() });
      setIsKeyConfigured(true);
      setInputApiKey("");
      setErrorMessage(null);
    } catch (e: any) {
      setErrorMessage(`Failed to save API key: ${e.toString()}`);
    }
  };

  const handleSend = async (customPrompt?: string) => {
    const textToSend = customPrompt ?? inputPrompt;
    if (!textToSend.trim() || isLoading) return;

    setErrorMessage(null);
    setMessages((prev) => [...prev, { role: "user", text: textToSend }]);
    if (!customPrompt) setInputPrompt("");
    setIsLoading(true);
    setCurrentResponse("");

    try {
      await invoke("send_prompt", {
        prompt: textToSend,
        systemInstruction: selectedPersona.prompt,
        imageBase64: attachedImage,
      });
      setAttachedImage(null);
    } catch (err: any) {
      setErrorMessage(err.toString());
      setIsLoading(false);
    }
  };

  const handleCancelRequest = async () => {
    await invoke("cancel_current_request");
    setIsLoading(false);
  };

  const handleNewChat = async () => {
    await invoke("clear_chat_history");
    setMessages([]);
    setCurrentResponse("");
    setErrorMessage(null);
  };

  const handleAskClipboard = async () => {
    try {
      const clipboardText = await readText();
      if (clipboardText) {
        setInputPrompt(`Regarding this clipboard content:\n\n"${clipboardText}"\n\n`);
      }
    } catch (e: any) {
      setErrorMessage("Could not read clipboard contents.");
    }
  };

  const handleQuickAction = (action: string) => {
    if (!inputPrompt.trim()) return;
    let prefix = "";
    switch (action) {
      case "summarize":
        prefix = "Please summarize the following concisely:\n\n";
        break;
      case "rewrite":
        prefix = "Please rewrite and refine the following text:\n\n";
        break;
      case "translate":
        prefix = "Please translate the following text into English:\n\n";
        break;
      case "explain":
        prefix = "Please explain the following clearly and simply:\n\n";
        break;
    }
    handleSend(prefix + inputPrompt);
  };

  const handleScreenCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { mediaSource: "screen" } as any,
      });
      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL("image/png");
      const base64 = dataUrl.split(",")[1];
      setAttachedImage(base64);

      stream.getTracks().forEach((track) => track.stop());
    } catch (err) {
      console.log("Screen capture canceled or failed", err);
    }
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // Recording & Dictation Logic
  const handleToggleRecording = () => {
    if (isRecordingRef.current) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || "audio/webm" });
        await processAudioForTranscription(audioBlob, mediaRecorder.mimeType || "audio/webm");
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setErrorMessage(null);
    } catch (err: any) {
      setErrorMessage("Microphone access denied or unavailable.");
      console.error(err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecordingRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const processAudioForTranscription = async (blob: Blob, mimeType: string) => {
    setIsTranscribing(true);
    try {
      const audioBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const res = reader.result as string;
          const base64 = res ? res.split(",")[1] : "";
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const transcription = await invoke<string>("transcribe_audio", {
        audioBase64,
        mimeType,
      });

      if (transcription) {
        setInputPrompt((prev) => (prev ? `${prev} ${transcription}` : transcription));
      }
    } catch (err: any) {
      setErrorMessage(`Transcription failed: ${err.toString()}`);
    } finally {
      setIsTranscribing(false);
    }
  };

  return (
    <div className="w-full h-screen bg-transparent select-none p-2 flex flex-col justify-start items-center">
      <div className="w-full max-w-[720px] bg-[#0d0d12]/90 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl text-white flex flex-col overflow-hidden transition-all duration-300">
        {/* Top Control Bar & Prompt Input */}
        <div className="p-3 flex flex-col gap-2 border-b border-white/10 bg-white/5">
          {!isKeyConfigured ? (
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-indigo-400 shrink-0" />
              <input
                type="password"
                placeholder="Enter your Gemini API key to start..."
                value={inputApiKey}
                onChange={(e) => setInputApiKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveApiKey()}
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/40 focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={handleSaveApiKey}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-medium transition"
              >
                Save
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder={
                    isRecording
                      ? "Listening... Speak now..."
                      : isTranscribing
                      ? "Transcribing audio..."
                      : "Ask anything, or use voice (Ctrl+Alt+V)..."
                  }
                  value={inputPrompt}
                  onChange={(e) => setInputPrompt(e.target.value)}
                  onFocus={() => invoke("set_input_focused", { focused: true })}
                  onBlur={() => invoke("set_input_focused", { focused: false })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  className="flex-1 bg-transparent border-none text-base text-white placeholder-white/35 focus:outline-none focus:ring-0 font-normal"
                />

                {/* Voice / Dictation Button */}
                <button
                  onClick={handleToggleRecording}
                  disabled={isTranscribing}
                  title={isRecording ? "Stop Recording" : "Voice Dictation (Ctrl+Alt+V)"}
                  className={`action-bounce p-1.5 rounded-lg transition-colors ${
                    isRecording
                      ? "bg-rose-600 animate-pulse text-white"
                      : isTranscribing
                      ? "bg-amber-600/50 text-white/70"
                      : "hover:bg-white/10 text-white/60 hover:text-white"
                  }`}
                >
                  {isTranscribing ? (
                    <Loader2 className="w-4 h-4 animate-spin text-amber-300" />
                  ) : isRecording ? (
                    <MicOff className="w-4 h-4" />
                  ) : (
                    <Mic className="w-4 h-4" />
                  )}
                </button>

                {isLoading ? (
                  <button
                    onClick={handleCancelRequest}
                    title="Cancel generation (Esc)"
                    className="action-bounce p-1.5 hover:bg-white/10 rounded-lg text-white/60 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => handleSend()}
                    disabled={!inputPrompt.trim()}
                    className="action-bounce p-1.5 bg-indigo-600/80 hover:bg-indigo-500 disabled:opacity-30 disabled:hover:bg-indigo-600/80 rounded-lg text-white"
                  >
                    <CornerDownLeft className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Quick Actions & Controls Bar */}
              <div className="flex items-center justify-between gap-1.5 pt-1 text-xs">
                {/* Left: Quick Action Chips */}
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                  <button
                    onClick={handleAskClipboard}
                    className="action-bounce flex items-center gap-1 px-2.5 py-1 bg-white/5 hover:bg-indigo-500/20 border border-white/10 hover:border-indigo-500/40 rounded-full text-white/80 hover:text-white shrink-0"
                  >
                    <Zap className="w-3 h-3 text-amber-400" />
                    <span>Ask Clipboard</span>
                  </button>
                  <button
                    onClick={() => handleQuickAction("summarize")}
                    className="action-bounce flex items-center gap-1 px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-white/70 hover:text-white shrink-0"
                  >
                    <Scissors className="w-3 h-3 text-blue-400" />
                    <span>Summarize</span>
                  </button>
                  <button
                    onClick={() => handleQuickAction("rewrite")}
                    className="action-bounce flex items-center gap-1 px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-white/70 hover:text-white shrink-0"
                  >
                    <Wand2 className="w-3 h-3 text-purple-400" />
                    <span>Rewrite</span>
                  </button>
                  <button
                    onClick={() => handleQuickAction("translate")}
                    className="action-bounce flex items-center gap-1 px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-white/70 hover:text-white shrink-0"
                  >
                    <Languages className="w-3 h-3 text-emerald-400" />
                    <span>Translate</span>
                  </button>
                  <button
                    onClick={() => handleQuickAction("explain")}
                    className="action-bounce flex items-center gap-1 px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-white/70 hover:text-white shrink-0"
                  >
                    <HelpCircle className="w-3 h-3 text-rose-400" />
                    <span>Explain</span>
                  </button>
                  <button
                    onClick={handleScreenCapture}
                    title="Attach screen context"
                    className={`action-bounce flex items-center gap-1 px-2 py-1 rounded-full border shrink-0 ${
                      attachedImage
                        ? "bg-indigo-600/30 border-indigo-400/50 text-indigo-200"
                        : "bg-white/5 hover:bg-white/10 border-white/10 text-white/70 hover:text-white"
                    }`}
                  >
                    <Camera className="w-3 h-3 text-cyan-400" />
                    <span>{attachedImage ? "Screen Attached" : "Screen"}</span>
                  </button>
                </div>

                {/* Right: Persona & New Chat */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="relative group">
                    <button className="action-bounce flex items-center gap-1 px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md text-white/70 hover:text-white">
                      <Layers className="w-3 h-3 text-indigo-400" />
                      <span>{selectedPersona.name}</span>
                    </button>
                    <div className="absolute right-0 bottom-full mb-1 hidden group-hover:flex flex-col bg-[#14141d] border border-white/10 rounded-lg p-1 shadow-xl z-50 min-w-[110px]">
                      {PERSONAS.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setSelectedPersona(p)}
                          className={`action-bounce text-left px-2 py-1 rounded text-xs ${
                            selectedPersona.id === p.id
                              ? "bg-indigo-600 text-white font-medium"
                              : "text-white/70 hover:bg-white/10"
                          }`}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={handleNewChat}
                    title="New Chat (Ctrl+N)"
                    className="action-bounce p-1 hover:bg-white/10 rounded-md text-white/60 hover:text-white"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Loading Shimmer Bar */}
        {isLoading && <div className="h-0.5 w-full shimmer-bg" />}

        {/* Error Notification */}
        {errorMessage && (
          <div className="px-4 py-2 bg-rose-950/40 border-b border-rose-500/20 text-rose-300 text-xs flex items-center justify-between">
            <span className="truncate">{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="action-bounce p-0.5 hover:text-white">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Conversation Stream & Response Zone */}
        {(messages.length > 0 || currentResponse) && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 max-h-[360px]">
            {messages.map((msg, index) => (
              <div
                key={index}
                className={`flex gap-2.5 text-sm ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {msg.role === "assistant" && (
                  <div className="w-6 h-6 rounded-full bg-indigo-600/30 border border-indigo-400/30 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-3.5 h-3.5 text-indigo-300" />
                  </div>
                )}
                <div
                  className={`relative group max-w-[85%] rounded-2xl px-3.5 py-2.5 text-white/90 leading-relaxed ${
                    msg.role === "user"
                      ? "bg-indigo-600/40 border border-indigo-500/30 rounded-br-none"
                      : "bg-white/5 border border-white/10 rounded-bl-none"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose prose-invert max-w-none text-sm space-y-2">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.text}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <span>{msg.text}</span>
                  )}

                  {msg.role === "assistant" && (
                    <button
                      onClick={() => copyToClipboard(msg.text, index)}
                      className="action-bounce absolute top-2 right-2 p-1 opacity-0 group-hover:opacity-100 bg-white/10 hover:bg-white/20 rounded text-white/70 hover:text-white"
                      title="Copy response"
                    >
                      {copiedIndex === index ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                    <User className="w-3.5 h-3.5 text-white/70" />
                  </div>
                )}
              </div>
            ))}

            {/* In-flight streaming response chunk */}
            {currentResponse && (
              <div className="flex gap-2.5 text-sm justify-start">
                <div className="w-6 h-6 rounded-full bg-indigo-600/30 border border-indigo-400/30 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-3.5 h-3.5 text-indigo-300" />
                </div>
                <div className="bg-white/5 border border-white/10 rounded-2xl rounded-bl-none px-3.5 py-2.5 text-white/90 leading-relaxed max-w-[85%]">
                  <div className="prose prose-invert max-w-none text-sm space-y-2">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {currentResponse}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            )}
            <div ref={responseEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}
