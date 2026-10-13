import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Sparkles,
  Key,
  CornerDownLeft,
  X,
  Copy,
  Check,
  RotateCcw,
  Bot,
  User,
  Zap,
  Scissors,
  Wand2,
  Languages,
  HelpCircle,
  Camera,
  Layers,
} from "lucide-react";

interface WindowStatePayload {
  expanded: boolean;
}

interface ChunkPayload {
  text: string;
}

interface ErrorPayload {
  error: string;
}

type Persona = {
  id: string;
  name: string;
  instruction: string;
};

const PERSONAS: Persona[] = [
  { id: "default", name: "Assistant", instruction: "You are a helpful, concise AI desktop assistant." },
  { id: "coder", name: "Coder", instruction: "You are an expert developer. Provide clear, accurate code solutions with minimal fluff." },
  { id: "writer", name: "Writer", instruction: "You are an expert editor and copywriter. Produce polished, clear, and compelling writing." },
  { id: "concise", name: "Concise", instruction: "Be extremely brief and direct in your answers. Maximum 2-3 sentences unless asked for code." },
];

export default function App() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [inputPrompt, setInputPrompt] = useState("");
  const [lastPrompt, setLastPrompt] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [currentResponse, setCurrentResponse] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedPersona, setSelectedPersona] = useState<Persona>(PERSONAS[0]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [attachedImage, setAttachedImage] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const responseEndRef = useRef<HTMLDivElement>(null);

  // Initial setup: check API key & listen to Tauri events
  useEffect(() => {
    checkApiKey();

    const unlistenWindowState = listen<WindowStatePayload>("window-state-changed", (event) => {
      setIsExpanded(event.payload.expanded);
      if (event.payload.expanded) {
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    });

    const unlistenChunk = listen<ChunkPayload>("ai-chunk", (event) => {
      setIsLoading(true);
      setCurrentResponse((prev) => prev + event.payload.text);
    });

    const unlistenDone = listen("ai-done", () => {
      setIsLoading(false);
      setCurrentResponse((prevResponse) => {
        if (prevResponse) {
          setMessages((prev) => [...prev, { role: "assistant", text: prevResponse }]);
        }
        return "";
      });
    });

    const unlistenError = listen<ErrorPayload>("ai-error", (event) => {
      setIsLoading(false);
      setErrorMessage(event.payload.error);
    });

    return () => {
      unlistenWindowState.then((f) => f());
      unlistenChunk.then((f) => f());
      unlistenDone.then((f) => f());
      unlistenError.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (responseEndRef.current) {
      responseEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, currentResponse]);

  async function checkApiKey() {
    try {
      const key = await invoke<string | null>("get_api_key");
      setHasApiKey(!!key);
    } catch {
      setHasApiKey(false);
    }
  }

  async function handleSaveKey(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKeyInput.trim()) return;
    try {
      await invoke("save_api_key", { key: apiKeyInput.trim() });
      setHasApiKey(true);
      setApiKeyInput("");
    } catch (err) {
      setErrorMessage(String(err));
    }
  }

  async function handleSend(promptText?: string) {
    const textToSend = promptText || inputPrompt;
    if (!textToSend.trim() || isLoading) return;

    setErrorMessage(null);
    setLastPrompt(textToSend);
    setMessages((prev) => [...prev, { role: "user", text: textToSend }]);
    setInputPrompt("");
    setCurrentResponse("");
    setIsLoading(true);

    try {
      await invoke("send_prompt", {
        prompt: textToSend,
        systemInstruction: selectedPersona.instruction,
        imageBase64: attachedImage,
      });
      setAttachedImage(null);
    } catch (err) {
      setIsLoading(false);
      setErrorMessage(String(err));
    }
  }

  async function handleAskClipboard() {
    try {
      const clipboardText = await readText();
      if (!clipboardText) {
        setErrorMessage("Clipboard is empty or contains non-text content.");
        return;
      }
      const prompt = `Here is text from my clipboard:\n\n"${clipboardText}"\n\nPlease analyze, summarize, or answer questions about it.`;
      handleSend(prompt);
    } catch (err) {
      setErrorMessage(`Failed to read clipboard: ${err}`);
    }
  }

  async function handleNewChat() {
    try {
      await invoke("cancel_current_request");
      await invoke("clear_chat_history");
      setMessages([]);
      setCurrentResponse("");
      setIsLoading(false);
      setErrorMessage(null);
      setAttachedImage(null);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleCancelRequest() {
    try {
      await invoke("cancel_current_request");
      setIsLoading(false);
      if (currentResponse) {
        setMessages((prev) => [...prev, { role: "assistant", text: currentResponse + " [Cancelled]" }]);
        setCurrentResponse("");
      }
    } catch (err) {
      console.error(err);
    }
  }

  function handleQuickAction(actionType: string) {
    if (messages.length === 0 && !inputPrompt.trim()) return;
    const lastMsg = messages[messages.length - 1]?.text || inputPrompt;

    let actionPrompt = "";
    switch (actionType) {
      case "summarize":
        actionPrompt = `Summarize the following clearly in concise bullet points:\n\n${lastMsg}`;
        break;
      case "rewrite":
        actionPrompt = `Rewrite the following text to make it more clear, professional, and elegant:\n\n${lastMsg}`;
        break;
      case "translate":
        actionPrompt = `Translate the following text into clear, fluent English (or Spanish if already in English):\n\n${lastMsg}`;
        break;
      case "explain":
        actionPrompt = `Explain the key concepts in simple terms:\n\n${lastMsg}`;
        break;
    }
    if (actionPrompt) {
      handleSend(actionPrompt);
    }
  }

  // Handle Screen Context Tool
  function handleScreenCapture() {
    const dummyImageBase64 = "iVBORw50KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    setAttachedImage(dummyImageBase64);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (isLoading) {
        handleCancelRequest();
      } else {
        invoke("toggle_window");
      }
    } else if (e.key === "ArrowUp") {
      if (!inputPrompt && lastPrompt) {
        e.preventDefault();
        setInputPrompt(lastPrompt);
      }
    } else if (e.ctrlKey && e.key === "n") {
      e.preventDefault();
      handleNewChat();
    }
  }

  function copyToClipboard(text: string, index: number) {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  }

  return (
    <div className="w-full h-screen flex flex-col items-center justify-start pointer-events-none">
      {/* Sleek dark glass bar container */}
      <div
        className={`w-[720px] max-h-[500px] flex flex-col bg-[#0d0d12]/80 backdrop-blur-2xl border border-white/10 rounded-b-[20px] shadow-2xl transition-all duration-220 ease-[cubic-bezier(0.22,1,0.36,1)] pointer-events-auto overflow-hidden ${
          isExpanded
            ? "translate-y-0 opacity-100 scale-100"
            : "-translate-y-full opacity-0 scale-98"
        }`}
        onFocus={() => invoke("set_input_focused", { focused: true })}
        onBlur={() => invoke("set_input_focused", { focused: false })}
      >
        {/* Top Header & Input Bar Zone */}
        <div className="p-3.5 border-b border-white/5 flex flex-col gap-2.5 bg-gradient-to-r from-indigo-900/10 via-transparent to-purple-900/10">
          {!hasApiKey ? (
            /* API Key Prompt */
            <form onSubmit={handleSaveKey} className="flex items-center gap-2">
              <Key className="w-4 h-4 text-indigo-400 shrink-0" />
              <input
                type="password"
                placeholder="Enter Gemini API key to start..."
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/40 focus:outline-none focus:border-indigo-500/50"
                autoFocus
              />
              <button
                type="submit"
                className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs px-3 py-1.5 rounded-lg font-medium transition"
              >
                Save Key
              </button>
            </form>
          ) : (
            <>
              {/* Main Command Input */}
              <div className="flex items-center gap-2.5 px-2">
                <Sparkles className="w-5 h-5 text-indigo-400 shrink-0 animate-pulse" />
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Ask anything... (Esc to close, Ctrl+N for new chat)"
                  value={inputPrompt}
                  onChange={(e) => setInputPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="flex-1 bg-transparent border-none text-base text-white placeholder-white/35 focus:outline-none focus:ring-0 font-normal"
                />
                {isLoading ? (
                  <button
                    onClick={handleCancelRequest}
                    title="Cancel generation (Esc)"
                    className="p-1.5 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition"
                  >
                    <X className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => handleSend()}
                    disabled={!inputPrompt.trim()}
                    className="p-1.5 bg-indigo-600/80 hover:bg-indigo-500 disabled:opacity-30 disabled:hover:bg-indigo-600/80 rounded-lg text-white transition"
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
                    className="flex items-center gap-1 px-2.5 py-1 bg-white/5 hover:bg-indigo-500/20 border border-white/10 hover:border-indigo-500/40 rounded-full text-white/80 hover:text-white transition shrink-0"
                  >
                    <Zap className="w-3 h-3 text-amber-400" />
                    <span>Ask Clipboard</span>
                  </button>
                  <button
                    onClick={() => handleQuickAction("summarize")}
                    className="flex items-center gap-1 px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-white/70 hover:text-white transition shrink-0"
                  >
                    <Scissors className="w-3 h-3 text-blue-400" />
                    <span>Summarize</span>
                  </button>
                  <button
                    onClick={() => handleQuickAction("rewrite")}
                    className="flex items-center gap-1 px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-white/70 hover:text-white transition shrink-0"
                  >
                    <Wand2 className="w-3 h-3 text-purple-400" />
                    <span>Rewrite</span>
                  </button>
                  <button
                    onClick={() => handleQuickAction("translate")}
                    className="flex items-center gap-1 px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-white/70 hover:text-white transition shrink-0"
                  >
                    <Languages className="w-3 h-3 text-emerald-400" />
                    <span>Translate</span>
                  </button>
                  <button
                    onClick={() => handleQuickAction("explain")}
                    className="flex items-center gap-1 px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-white/70 hover:text-white transition shrink-0"
                  >
                    <HelpCircle className="w-3 h-3 text-rose-400" />
                    <span>Explain</span>
                  </button>
                  <button
                    onClick={handleScreenCapture}
                    title="Attach screen context"
                    className={`flex items-center gap-1 px-2 py-1 rounded-full border transition shrink-0 ${
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
                    <button className="flex items-center gap-1 px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md text-white/70 hover:text-white transition">
                      <Layers className="w-3 h-3 text-indigo-400" />
                      <span>{selectedPersona.name}</span>
                    </button>
                    <div className="absolute right-0 bottom-full mb-1 hidden group-hover:flex flex-col bg-[#14141d] border border-white/10 rounded-lg p-1 shadow-xl z-50 min-w-[110px]">
                      {PERSONAS.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setSelectedPersona(p)}
                          className={`text-left px-2 py-1 rounded text-xs transition ${
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
                    className="p-1 hover:bg-white/10 rounded-md text-white/60 hover:text-white transition"
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
            <button onClick={() => setErrorMessage(null)} className="p-0.5 hover:text-white">
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
                      className="absolute top-2 right-2 p-1 opacity-0 group-hover:opacity-100 bg-white/10 hover:bg-white/20 rounded text-white/70 hover:text-white transition"
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
