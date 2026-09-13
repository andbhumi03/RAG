import { useState, useEffect, useLayoutEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getChatHistory, getChatMessages, createNewChat, deleteChat } from "../api/chat";
import { getUserDocuments, deleteDocument } from "../api/documents";
import api from "../api/axiosInstance";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";

// Consolidated Loader Spinner component
const LoadingSpinner = () => (
  <div className="animate-spin rounded-full h-5 w-5 border-2 border-[#a8c7fa] border-t-[#1a73e8] shrink-0" />
);

// Clean user error message: strips technical SDK leaks, status codes, and internal JSON
const cleanUserErrorMessage = (rawError) => {
  if (!rawError) return "Unable to complete request. Please try again.";

  let errText = typeof rawError === "string" ? rawError : (rawError.message || String(rawError));

  // If errText contains serialized JSON
  if (errText.trim().startsWith("{") || errText.includes('"error"')) {
    try {
      const match = errText.match(/(\{.*\})/s);
      if (match) {
        const parsed = JSON.parse(match[1]);
        if (parsed.error) {
          errText = typeof parsed.error === "string" ? parsed.error : (parsed.error.message || errText);
        }
      }
    } catch {
      // not JSON
    }
  }

  const lower = errText.toLowerCase();

  // Rate limit / Quota / TPM
  if (
    lower.includes("429") ||
    lower.includes("413") ||
    lower.includes("rate_limit") ||
    lower.includes("rate limit") ||
    lower.includes("tokens per minute") ||
    lower.includes("tpm") ||
    lower.includes("rpm") ||
    lower.includes("quota") ||
    lower.includes("too large for model") ||
    lower.includes("billing")
  ) {
    return "The AI service is currently experiencing high demand. Please wait a few moments and try again.";
  }

  // Model unavailable / 404 / 503 / decommissioned
  if (
    lower.includes("404") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504") ||
    lower.includes("model_not_found") ||
    lower.includes("model_decommissioned") ||
    lower.includes("does not exist") ||
    lower.includes("not available") ||
    lower.includes("decommissioned") ||
    lower.includes("overloaded") ||
    lower.includes("service unavailable") ||
    lower.includes("groq")
  ) {
    return "The AI assistant is temporarily unavailable. Please try again in a few moments.";
  }

  // Guardrails / safety
  if (
    lower.includes("guardrail") ||
    lower.includes("safety") ||
    lower.includes("content filter") ||
    lower.includes("content_filter") ||
    lower.includes("moderation") ||
    lower.includes("blocked")
  ) {
    return "I cannot generate a response for this request due to content safety guidelines. Please ask another question about your documents.";
  }

  // Database / Mongoose
  if (
    lower.includes("validation failed") ||
    lower.includes("path 'content'") ||
    lower.includes("content: path") ||
    lower.includes("mongo") ||
    lower.includes("database")
  ) {
    return "A temporary system error occurred while processing your request. Please try again.";
  }

  // Network / HTTP status
  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("streaming request failed") ||
    lower.includes("500")
  ) {
    return "A network error occurred while contacting the server. Please check your connection and try again.";
  }

  return errText;
};

export default function Chat() {
  const [activeTab, setActiveTab] = useState("chat");
  const [input, setInput] = useState("");
  const [sessions, setSessions] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);

  // Documents management state
  const [documents, setDocuments] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // Modals, Drawers & Toast Notifications
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [toast, setToast] = useState({ show: false, message: "", type: "success" });

  const { user } = useAuth();
  const navigate = useNavigate();

  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const isSwitchingChatRef = useRef(true);
  const abortControllerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    loadSessions();
    loadDocuments();
  }, []);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (exportOpen && !e.target.closest(".export-dropdown-container")) {
        setExportOpen(false);
      }
    };
    window.addEventListener("click", handleOutsideClick);
    return () => window.removeEventListener("click", handleOutsideClick);
  }, [exportOpen]);

  // Instant direct positioning to the recent message on load/switch before browser paint
  useLayoutEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, activeChatId]);

  // Secondary guard to ensure bottom scroll after any Markdown rendering or layout pass
  useEffect(() => {
    const scrollToLatest = () => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      }
    };

    scrollToLatest();
    const frameId = requestAnimationFrame(scrollToLatest);
    const timerId = setTimeout(scrollToLatest, 50);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(timerId);
    };
  }, [messages, activeChatId, loading]);

  // Toast trigger helper
  const showToast = (message, type = "success") => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast({ show: false, message: "", type: "success" });
    }, 1500);
  };

  const loadSessions = async () => {
    try {
      const data = await getChatHistory();
      setSessions(data || []);
      if (data && data.length > 0 && !activeChatId) {
        selectChat(data[0]._id);
      }
    } catch (err) {
      console.error("Failed to fetch sessions", err);
    }
  };

  const loadDocuments = async () => {
    try {
      setLoadingDocs(true);
      const docs = await getUserDocuments();
      setDocuments(docs || []);
    } catch (err) {
      console.error("Failed to load docs", err);
    } finally {
      setLoadingDocs(false);
    }
  };

  const selectChat = async (chatId) => {
    setActiveChatId(chatId);
    isSwitchingChatRef.current = true;
    try {
      const msgs = await getChatMessages(chatId);
      setMessages(msgs || []);
    } catch (err) {
      console.error("Failed to load messages", err);
    }
  };

  const handleNewChat = async () => {
    if (creatingChat) return;
    setCreatingChat(true);
    isSwitchingChatRef.current = true;
    try {
      const newSession = await createNewChat();
      setSessions([newSession, ...sessions]);
      setActiveChatId(newSession._id);
      setMessages([]);
      showToast("New chat session initialized!");
    } catch (err) {
      console.error("Failed new chat", err);
    } finally {
      setCreatingChat(false);
    }
  };

  const handleDeleteChat = async (e, chatId) => {
    e.stopPropagation();
    setDeleteTarget(chatId); // Yeh modal ko trigger karega
  };

  const confirmDeleteChat = async () => {
    const chatId = deleteTarget;
    setDeleteTarget(null); // Modal close kar do
    if (!chatId) return;

    try {
      await deleteChat(chatId);
      const updated = sessions.filter((s) => s._id !== chatId);
      setSessions(updated);
      showToast("Chat deleted successfully");

      if (activeChatId === chatId) {
        const next = updated[0]?._id || null;
        setActiveChatId(next);
        if (next) selectChat(next);
        else setMessages([]);
      }
    } catch (err) {
      console.error("Failed delete chat", err);
      showToast("Failed to delete chat", "error");
    }
  };

  const handleCopy = (text, index) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    showToast("Copied to clipboard!");
    setTimeout(() => {
      setCopiedIndex((prev) => (prev === index ? null : prev));
    }, 2000);
  };

  const executeStreamingQuery = async (userText, targetIndex = null) => {
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setLoading(true);

    try {
      const response = await fetch(`${api.defaults.baseURL}/chat/query-stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ question: userText, chatId: activeChatId }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        let serverMessage = `Streaming request failed with status ${response.status}`;
        try {
          const errorPayload = await response.json();
          serverMessage = errorPayload.error || serverMessage;
        } catch {
          // Keep default
        }
        throw new Error(serverMessage);
      }

      if (!response.body) {
        throw new Error("The browser did not receive a streaming response.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const applyEvent = (event) => {
        let cleanEvent = event.trim();
        if (cleanEvent.startsWith("data:")) {
          cleanEvent = cleanEvent.slice(5).trim();
        }

        if (!cleanEvent || cleanEvent.startsWith(":")) return false;
        if (cleanEvent === "[DONE]") return true;

        try {
          const payload = JSON.parse(cleanEvent);
          if (payload.text) {
            setMessages((prev) => {
              const updated = [...prev];
              const idx = targetIndex !== null ? targetIndex : updated.length - 1;
              if (idx >= 0 && (updated[idx].sender === "ai" || updated[idx].role === "assistant")) {
                updated[idx] = {
                  ...updated[idx],
                  text: `${updated[idx].text || ""}${payload.text}`,
                };
              }
              return updated;
            });
          }
          if (payload.sources) {
            setMessages((prev) => {
              const updated = [...prev];
              const idx = targetIndex !== null ? targetIndex : updated.length - 1;
              if (idx >= 0) updated[idx] = { ...updated[idx], sources: payload.sources };
              return updated;
            });
          }
          if (payload.chatId) {
            setActiveChatId(payload.chatId);
          }
          if (payload.chatTitle) {
            setSessions((prev) => {
              const exists = prev.some((s) => s._id === payload.chatId);
              if (exists) {
                return prev.map((s) =>
                  s._id === payload.chatId ? { ...s, title: payload.chatTitle } : s
                );
              } else {
                return [{ _id: payload.chatId, title: payload.chatTitle }, ...prev];
              }
            });
          }
          if (payload.error) {
            const friendly = cleanUserErrorMessage(payload.error);
            setMessages((prev) => {
              const updated = [...prev];
              const idx = targetIndex !== null ? targetIndex : updated.length - 1;
              if (idx >= 0 && (updated[idx].sender === "ai" || updated[idx].role === "assistant")) {
                updated[idx] = { ...updated[idx], text: friendly, isError: true };
              }
              return updated;
            });
          }
        } catch (parseError) {
          setMessages((prev) => {
            const updated = [...prev];
            const idx = targetIndex !== null ? targetIndex : updated.length - 1;
            if (idx >= 0 && (updated[idx].sender === "ai" || updated[idx].role === "assistant")) {
              updated[idx] = {
                ...updated[idx],
                text: `${updated[idx].text || ""}${cleanEvent}`,
              };
            }
            return updated;
          });
        }
        return false;
      };

      let finished = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          if (buffer.trim()) applyEvent(buffer);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop();

        for (const event of events) {
          finished = applyEvent(event) || finished;
        }
        if (finished) break;
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error("Streaming error:", error);
        const friendly = cleanUserErrorMessage(error.message);
        setMessages((prev) => {
          const updated = [...prev];
          const idx = targetIndex !== null ? targetIndex : updated.length - 1;
          if (idx >= 0 && (updated[idx].sender === "ai" || updated[idx].role === "assistant") && !updated[idx].text) {
            updated[idx] = { ...updated[idx], text: friendly, isError: true };
          }
          return updated;
        });
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
      inputRef.current?.focus();
    }
  };

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    if (!input.trim() || loading) return;

    const userText = input;
    setInput("");

    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    setMessages((prev) => [
      ...prev,
      { sender: "user", text: userText },
      { sender: "ai", text: "" },
    ]);

    await executeStreamingQuery(userText);
  };

  const handleRetry = async (aiMsgIndex) => {
    if (loading) return;

    // Find the user question that prompted this AI response
    let promptQuestion = "";
    for (let j = aiMsgIndex - 1; j >= 0; j--) {
      const m = messages[j];
      const isUser = m.sender ? m.sender === "user" : m.role === "user";
      if (isUser) {
        promptQuestion = m.text || m.content || "";
        break;
      }
    }

    if (!promptQuestion) {
      showToast("No question found to retry", "error");
      return;
    }

    setMessages((prev) => {
      const updated = [...prev];
      updated[aiMsgIndex] = {
        ...updated[aiMsgIndex],
        sender: "ai",
        text: "",
        content: "",
        isError: false,
        sources: []
      };
      return updated;
    });

    await executeStreamingQuery(promptQuestion, aiMsgIndex);
  };

  const stopGenerating = () => {
    abortControllerRef.current?.abort();
  };

  const exportChat = (format) => {
    if (!messages.length) return;
    let content = "";
    let filename = `chat-export-${activeChatId || "session"}`;
    if (format === "markdown") {
      filename += ".md";
      content = `# Chat Export\n\n`;
      messages.forEach((msg) => {
        const isUser = msg.sender ? msg.sender === "user" : msg.role === "user";
        const role = isUser ? "User" : "AI";
        content += `### ${role}\n${msg.text || msg.content || ""}\n\n`;
        if (msg.sources && msg.sources.length > 0) {
          content += `*Sources: ${msg.sources.map((s) => s.fileName || "Document").join(", ")}*\n\n`;
        }
        content += `---\n\n`;
      });
    } else if (format === "json") {
      filename += ".json";
      content = JSON.stringify(messages, null, 2);
    }
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Chat exported as ${format.toUpperCase()}`);
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = async (file) => {
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      alert("File size exceeds 10MB limit.");
      return;
    }

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx', 'txt'].includes(ext)) {
      alert("Unsupported file format. Please upload PDF, DOCX, or TXT.");
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      // Let the browser set the multipart boundary automatically.
      const res = await api.post("/documents/upload", formData);

      if (res.data) {
        const newDoc = {
          _id: res.data.documentId,
          fileName: res.data.fileName,
          status: res.data.status,
          chunkCount: res.data.chunkCount,
          createdAt: res.data.uploadDate || new Date().toISOString()
        };
        setDocuments((prev) => [newDoc, ...prev]);
        showToast(`Document "${file.name}" indexed successfully!`);
      } else {
        await loadDocuments();
        showToast("Document uploaded.");
      }
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || err.message || "Failed to upload document.");
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDoc = async (id) => {
    if (!confirm("Are you sure you want to delete this document?")) return;
    try {
      await deleteDocument(id);
      setDocuments((prev) => prev.filter((d) => d._id !== id));
      showToast("Document deleted successfully");
    } catch (err) {
      console.error(err);
      alert("Failed to delete document.");
    }
  };

  const handleSuggestionClick = (promptText) => {
    setInput(promptText);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleTextareaChange = (e) => {
    setInput(e.target.value);
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  };

  const handleTextareaKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };

  const formatResponseSystematically = (rawText) => {
    if (!rawText) return null;
    const cleanText = rawText
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?[^>]+(>|$)/g, "");

    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="text-[#1f1f1f] text-sm leading-relaxed mb-4">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-6 my-3 space-y-1.5 text-[#5f6368] text-sm">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-6 my-3 space-y-1.5 text-[#5f6368] text-sm">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          h1: ({ children }) => <h1 className="text-lg font-black text-[#1f1f1f] tracking-tight mt-6 mb-3">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-bold text-[#1f1f1f] mt-5 mb-2.5">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-bold text-[#1f1f1f] mt-4 mb-2">{children}</h3>,
          table: ({ children }) => (
            <div className="overflow-x-auto my-4 border border-[#e3e8ef] rounded-xl shadow-xs">
              <table className="min-w-full divide-y divide-[#e3e8ef] text-xs text-left">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => <th className="bg-[#f0f4f9] px-4 py-2.5 font-bold text-[#1f1f1f] border-b border-[#e3e8ef]">{children}</th>,
          td: ({ children }) => <td className="px-4 py-2.5 text-[#5f6368] border-b border-[#e3e8ef] last:border-b-0">{children}</td>,
          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || "");
            const codeText = String(children).replace(/\n$/, "");
            const isBlock = match || codeText.includes("\n");
            if (isBlock) {
              return (
                <div className="my-5 border border-[#e3e8ef] rounded-2xl overflow-hidden shadow-sm bg-[#f0f4f9]">
                  <div className="bg-[#e3e8ef] border-b border-[#e3e8ef] px-4 py-2 flex items-center justify-between text-xs text-[#5f6368] font-mono tracking-wider font-semibold">
                    <span>{match ? match[1] : "code"}</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(codeText);
                        showToast("Code copied to clipboard!");
                      }}
                      className="text-[#1a73e8] hover:text-[#1557b0] transition-colors font-bold cursor-pointer"
                    >
                      Copy
                    </button>
                  </div>
                  <pre className="p-4 bg-[#f8fafc] text-[#1f1f1f] text-sm font-mono overflow-x-auto leading-relaxed">
                    <code>{codeText}</code>
                  </pre>
                </div>
              );
            }
            return (
              <code className="font-mono text-xs bg-[#e3e8ef] text-[#1a73e8] px-1.5 py-0.5 rounded font-semibold" {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {cleanText}
      </ReactMarkdown>
    );
  };

  const chatSidebarProps = {
    sessions,
    activeChatId,
    creatingChat,
    onSelectChat: selectChat,
    onNewChat: handleNewChat,
    onDeleteChat: handleDeleteChat,
  };

  const truncateFileName = (name) => {
    if (!name) return "";
    if (name.length <= 15) return name;
    const extIndex = name.lastIndexOf('.');
    if (extIndex !== -1 && name.length - extIndex <= 5) {
      const ext = name.substring(extIndex);
      const base = name.substring(0, 10);
      return `${base}...${ext}`;
    }
    return `${name.substring(0, 12)}...`;
  };

  const currentChatTitle = sessions.find((s) => s._id === activeChatId)?.title || "Chat Assistant";

  return (
    <Layout chatSidebarProps={chatSidebarProps} hideSidebar={activeTab === "documents"}>
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-white relative">

        {/* Top Header */}
        <header className="h-16 border-b border-[#e3e8ef] px-6 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h2 className="font-bold text-sm text-[#1f1f1f] truncate max-w-[120px] sm:max-w-xs md:max-w-md">
              {currentChatTitle}
            </h2>
          </div>

          <div className="flex bg-[#f0f4f9] p-1 rounded-2xl border border-[#e3e8ef] shadow-inner">
            <button
              onClick={() => setActiveTab("chat")}
              className={`px-5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${activeTab === "chat"
                ? "bg-white text-[#004a77] shadow-sm font-bold"
                : "text-[#5f6368] hover:text-[#1f1f1f]"
                }`}
            >
              Chat
            </button>
            <button
              onClick={() => setActiveTab("documents")}
              className={`px-5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${activeTab === "documents"
                ? "bg-white text-[#004a77] shadow-sm font-bold"
                : "text-[#5f6368] hover:text-[#1f1f1f]"
                }`}
            >
              My Documents
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative export-dropdown-container">
              <button
                type="button"
                onClick={() => {
                  if (messages.length === 0) {
                    showToast("No chat messages to export yet", "error");
                    return;
                  }
                  setExportOpen((open) => !open);
                }}
                className={`inline-flex items-center gap-1.5 rounded-xl border border-[#e3e8ef] bg-[#f0f4f9] px-3.5 py-1.5 text-xs font-bold text-[#1f1f1f] hover:bg-[#e3e8ef] transition shadow-xs cursor-pointer ${
                  messages.length === 0 ? "opacity-60" : ""
                }`}
                title="Export chat history"
              >
                <svg className="w-3.5 h-3.5 text-[#5f6368]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span>Export</span>
                <svg className="w-3.5 h-3.5 text-[#5f6368]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {exportOpen && messages.length > 0 && (
                <div className="absolute right-0 top-10 z-20 w-44 rounded-2xl border border-[#e3e8ef] bg-white p-1.5 shadow-xl transition-all">
                  <button
                    onClick={() => {
                      exportChat("markdown");
                      setExportOpen(false);
                    }}
                    className="w-full text-left text-xs text-[#1f1f1f] hover:bg-[#f0f4f9] rounded-xl px-3 py-2 font-semibold flex items-center gap-2 cursor-pointer"
                  >
                    <span>Markdown (.md)</span>
                  </button>
                  <button
                    onClick={() => {
                      exportChat("json");
                      setExportOpen(false);
                    }}
                    className="w-full text-left text-xs text-[#1f1f1f] hover:bg-[#f0f4f9] rounded-xl px-3 py-2 font-semibold flex items-center gap-2 cursor-pointer"
                  >
                    <span>JSON (.json)</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {activeTab === "chat" ? (
          <div className="flex-1 flex flex-col overflow-hidden relative">

            {toast.show && (
              <div className="mx-6 mt-4 bg-[#f0f4f9] border border-[#a8c7fa] text-[#004a77] font-semibold text-xs py-2.5 px-4 rounded-xl flex items-center gap-2 shrink-0 transition-all max-w-6xl w-full mx-auto">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                {toast.message}
              </div>
            )}

            <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-6 space-y-6 max-w-6xl w-full mx-auto pb-10">
              {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center px-4 py-16 space-y-10 animate-fade-in mt-10">
                  <div className="space-y-4">
                    <h1 className="text-4xl sm:text-5xl font-black tracking-tight leading-none bg-gradient-to-r from-[#1a73e8] via-[#a142f4] to-[#ea4335] bg-clip-text text-transparent">
                      Hello, {user?.name || user?.email?.split('@')[0] || "bhumi"}
                    </h1>
                    <h2 className="text-3xl sm:text-4xl font-extrabold text-[#5f6368] tracking-tight">
                      How can I help you today?
                    </h2>
                    <p className="text-xs text-[#5f6368] max-w-md mx-auto leading-relaxed">
                      Ask questions grounded directly in your document index. The assistant will search the vector space and formulate a structured answer.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-4xl w-full">
                    <button
                      onClick={() => handleSuggestionClick("Summarize the main points of my uploaded documents.")}
                      className="p-5 text-left bg-[#f0f4f9] border border-[#e3e8ef] rounded-3xl hover:bg-[#e3e8ef] transition-all duration-200 cursor-pointer group"
                    >
                      <p className="font-bold text-xs text-[#1f1f1f] group-hover:text-[#1a73e8] transition-colors">📄 Summarize Documents</p>
                      <p className="text-[11px] text-[#5f6368] mt-1.5 leading-relaxed">Get an overview of key points from all your uploaded files.</p>
                    </button>
                    <button
                      onClick={() => handleSuggestionClick("What are the key policies and guidelines outlined in the text?")}
                      className="p-5 text-left bg-[#f0f4f9] border border-[#e3e8ef] rounded-3xl hover:bg-[#e3e8ef] transition-all duration-200 cursor-pointer group"
                    >
                      <p className="font-bold text-xs text-[#1f1f1f] group-hover:text-[#1a73e8] transition-colors">⚖️ Extract Guidelines</p>
                      <p className="text-[11px] text-[#5f6368] mt-1.5 leading-relaxed">List operational constraints described in the documents.</p>
                    </button>
                  </div>
                </div>
              )}

              {messages.map((msg, i) => {
                const isUser = msg.sender ? msg.sender === "user" : msg.role === "user";
                return (
                  <div key={i} className={`flex gap-3.5 ${isUser ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[78%] rounded-2xl px-5 py-4 leading-relaxed transition-all ${isUser
                        ? "bg-[#f0f4f9] text-[#1f1f1f] rounded-tr-none font-medium shadow-xs border border-[#e3e8ef]"
                        : "bg-transparent text-[#1f1f1f]"
                        }`}
                    >
                      {!isUser ? (
                        <div className="space-y-1.5">
                          {(!msg.text && !msg.content && loading && i === messages.length - 1) ? (
                            <div className="flex items-center gap-2.5 py-1">
                              <LoadingSpinner />
                              <span className="font-semibold text-[#5f6368] text-xs">Assistant is thinking...</span>
                            </div>
                          ) : (
                            <>
                              {msg.isError || (typeof (msg.text ?? msg.content) === 'string' && ((msg.text ?? msg.content).includes('"error":') || (msg.text ?? msg.content).includes('Path \'content\'') || (msg.text ?? msg.content).includes('tokens per minute'))) ? (
                                <div className="flex flex-col gap-2 p-3.5 rounded-2xl bg-amber-50/80 border border-amber-200 text-amber-900 max-w-lg shadow-xs my-1">
                                  <div className="flex items-center gap-2">
                                    <svg className="w-4 h-4 text-amber-600 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                    </svg>
                                    <span className="font-bold text-xs text-amber-800">System Notice</span>
                                  </div>
                                  <p className="text-xs text-amber-900 leading-relaxed font-medium">
                                    {cleanUserErrorMessage(msg.text ?? msg.content ?? "")}
                                  </p>
                                </div>
                              ) : (
                                formatResponseSystematically(msg.text ?? msg.content ?? "")
                              )}

                              {msg.sources && msg.sources.length > 0 && (
                                <div className="mt-4 pt-3 border-t border-[#e3e8ef] flex flex-col gap-2">
                                  <div className="flex items-center gap-1.5 text-[10px] text-[#1a73e8] font-bold uppercase tracking-wider select-none">
                                    <span>Grounded Sources</span>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {msg.sources.map((source, sIdx) => (
                                      <div
                                        key={sIdx}
                                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#f0f4f9] border border-[#e3e8ef] text-xs text-[#5f6368] hover:bg-[#e3e8ef] hover:text-[#1f1f1f] transition select-none max-w-xs"
                                        title={source.fileName || "Vector Source Document"}
                                      >
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                                        <span className="truncate">{truncateFileName(source.fileName) || "Source Document"}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {(msg.text || msg.content) && (
                                <div className="mt-3 pt-2 flex items-center gap-1 border-t border-[#e3e8ef]/60">
                                  <button
                                    type="button"
                                    onClick={() => handleCopy(msg.text ?? msg.content ?? "", i)}
                                    className="p-1.5 rounded-lg text-[#5f6368] hover:text-[#1f1f1f] hover:bg-[#f0f4f9] border border-transparent hover:border-[#e3e8ef] transition-all cursor-pointer select-none"
                                    title="Copy response"
                                    aria-label="Copy response"
                                  >
                                    {copiedIndex === i ? (
                                      <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                      </svg>
                                    ) : (
                                      <svg className="w-4 h-4 text-[#5f6368]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                      </svg>
                                    )}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => handleRetry(i)}
                                    disabled={loading}
                                    className="p-1.5 rounded-lg text-[#5f6368] hover:text-[#1f1f1f] hover:bg-[#f0f4f9] border border-transparent hover:border-[#e3e8ef] transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer select-none"
                                    title="Retry response"
                                    aria-label="Retry response"
                                  >
                                    <svg className={`w-4 h-4 text-[#5f6368] ${loading && i === messages.length - 1 ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          <p className="whitespace-pre-wrap text-sm">{msg.text ?? msg.content ?? ""}</p>
                          <div className="flex justify-end pt-0.5">
                            <button
                              type="button"
                              onClick={() => handleCopy(msg.text ?? msg.content ?? "", i)}
                              className="p-1 rounded-lg text-[#5f6368] hover:text-[#1f1f1f] hover:bg-[#e3e8ef] transition-all cursor-pointer select-none"
                              title="Copy message"
                              aria-label="Copy message"
                            >
                              {copiedIndex === i ? (
                                <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              ) : (
                                <svg className="w-3.5 h-3.5 text-[#5f6368]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              )}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 bg-white shrink-0 border-t border-[#e3e8ef]">
              <form onSubmit={handleSend} className="max-w-6xl mx-auto relative flex items-center">
                <div className="relative w-full flex items-center bg-[#f0f4f9] border border-transparent rounded-[28px] focus-within:bg-white focus-within:border-[#a8c7fa] focus-within:ring-2 focus-within:ring-sky-500/10 transition-all p-2 pl-4 pr-14 shadow-md">
                  <label
                    htmlFor="prompt-inline-uploader"
                    className="p-2 mr-1 rounded-full text-[#5f6368] hover:bg-[#e3e8ef] hover:text-[#1f1f1f] transition-colors cursor-pointer shrink-0"
                    title="Upload source file"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                  </label>
                  <input
                    type="file"
                    id="prompt-inline-uploader"
                    className="hidden"
                    accept=".pdf,.docx,.txt"
                    onChange={handleFileInput}
                    disabled={uploading}
                  />

                  <textarea
                    ref={inputRef}
                    rows={1}
                    value={input}
                    onChange={handleTextareaChange}
                    onKeyDown={handleTextareaKeyDown}
                    placeholder="Ask RAG Workspace anything about your documents..."
                    disabled={loading && !abortControllerRef.current}
                    className="w-full bg-transparent focus:outline-none text-[#1f1f1f] placeholder-[#5f6368] text-sm py-2 max-h-[160px] resize-none overflow-y-auto leading-relaxed custom-scrollbar shrink"
                  />

                  <div className="absolute right-3 flex items-center">
                    {loading ? (
                      <button
                        type="button"
                        onClick={stopGenerating}
                        className="h-9 w-9 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center transition shadow-lg cursor-pointer"
                        title="Stop generating"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <rect x="6" y="6" width="12" height="12" rx="2" />
                        </svg>
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={!input.trim()}
                        className="h-9 w-9 rounded-full bg-[#1a73e8] hover:bg-[#1557b0] text-white flex items-center justify-center transition shadow-md disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <svg className="w-4 h-4 rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </form>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col h-full overflow-hidden p-6 max-w-6xl w-full mx-auto">
            <div className="mb-6 flex items-center justify-between border-b border-[#e3e8ef] pb-4 shrink-0">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#1a73e8] mb-1 block">
                  Knowledge Resource
                </span>
                <h1 className="text-xl font-black text-[#1f1f1f] tracking-tight">
                  Documents Base
                </h1>
              </div>
            </div>

            {toast.show && (
              <div className="mb-4 bg-[#f0f4f9] border border-[#a8c7fa] text-[#004a77] font-semibold text-xs py-2.5 px-4 rounded-xl flex items-center gap-2 shrink-0 transition-all">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                {toast.message}
              </div>
            )}

            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-3xl p-6 text-center transition-all duration-300 mb-6 shrink-0 relative overflow-hidden ${dragActive
                ? "border-sky-500 bg-sky-500/5"
                : "border-[#e3e8ef] bg-[#f0f4f9] hover:border-[#a8c7fa] hover:bg-[#e3e8ef]/60"
                } shadow-xs`}
            >
              <input
                type="file"
                id="documents-upload-tab-input"
                className="hidden"
                accept=".pdf,.docx,.txt"
                onChange={handleFileInput}
                disabled={uploading}
              />
              <label
                htmlFor="documents-upload-tab-input"
                className={`flex flex-col items-center justify-center cursor-pointer ${uploading ? "pointer-events-none" : ""}`}
              >
                {uploading ? (
                  <div className="flex flex-col items-center">
                    <LoadingSpinner />
                    <h3 className="text-sm font-bold text-[#1f1f1f] mt-3">Processing Document...</h3>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <div className="h-10 w-10 rounded-2xl bg-sky-500/10 text-[#1a73e8] flex items-center justify-center mb-2 shadow-inner">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>
                    <h3 className="text-xs font-bold text-[#1f1f1f]">
                      Click to upload or drag & drop
                    </h3>
                    <p className="text-[10px] text-[#5f6368] mt-0.5">
                      Supports PDF, DOCX, or TXT files up to 10MB
                    </p>
                  </div>
                )}
              </label>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 bg-[#f0f4f9]/30 rounded-3xl border border-[#e3e8ef]">
              {loadingDocs ? (
                <div className="p-10 flex flex-col items-center justify-center">
                  <LoadingSpinner />
                  <p className="text-[#5f6368] text-xs font-semibold mt-3.5">Fetching indexed workspace...</p>
                </div>
              ) : documents.length === 0 ? (
                <div className="p-10 text-center flex flex-col items-center justify-center">
                  <h3 className="text-[#1f1f1f] text-sm font-bold">No documents indexed</h3>
                  <p className="text-[#5f6368] text-xs mt-1.5 max-w-sm leading-relaxed">
                    Upload documents using the drop zone above.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-[#f0f4f9] text-[#5f6368] border-b border-[#e3e8ef] font-bold uppercase tracking-wider sticky top-0 z-10">
                      <tr>
                        <th className="px-6 py-4">File Name</th>
                        <th className="px-6 py-4">Date Indexed</th>
                        <th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e3e8ef] text-[#1f1f1f]">
                      {documents.map((doc) => (
                        <tr key={doc._id} className="hover:bg-[#f0f4f9]/45 transition-colors">
                          <td className="px-6 py-4 font-bold text-[#1f1f1f] flex items-center gap-3">
                            <div className="h-8 w-8 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-[#1a73e8] shrink-0">
                              <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </div>
                            {/* FIX APPLIED HERE: Changed 'block' to 'inline-block' to resolve propertyIgnoredDueToDisplay warning */}
                            <span className="truncate max-w-xs lg:max-w-md inline-block align-middle" title={doc.fileName}>
                              {doc.fileName}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-[#5f6368]">
                            {new Date(doc.createdAt).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4 text-right flex items-center justify-end">
                            <button
                              onClick={() => handleDeleteDoc(doc._id)}
                              className="inline-flex items-center gap-1 text-red-600 hover:text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-xl font-bold text-xs transition cursor-pointer"
                            >
                              <span>Delete</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {/* Chat Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full mx-4 border border-[#e3e8ef] shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-[#1f1f1f]">Delete Chat?</h3>
            <p className="text-xs text-[#5f6368] leading-relaxed">
              Are you sure you want to delete this chat session? This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-[#5f6368] hover:bg-[#f0f4f9] transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteChat}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 text-white hover:bg-red-700 transition shadow-md cursor-pointer"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Chat Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full mx-4 border border-[#e3e8ef] shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-[#1f1f1f]">Delete Chat?</h3>
            <p className="text-xs text-[#5f6368] leading-relaxed">
              Are you sure you want to delete this chat session? This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-[#5f6368] hover:bg-[#f0f4f9] transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteChat}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 text-white hover:bg-red-700 transition shadow-md cursor-pointer"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </Layout>
  );
}
