import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { chatbotConfig } from "./chatbotConfig";
import { useChatbot } from "./useChatbot";
import "./ChatBot.css";

export default function ChatBot({ role = "merchant" }) {
  const config = chatbotConfig[role];
  const { messages, input, setInput, images, handleImageFile, removeImage, loading, sendMessage, messagesEndRef } =
    useChatbot(role, config);
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [position, setPosition] = useState({ x: window.innerWidth - 390, y: window.innerHeight - 520 });
  const fileInputRef = useRef(null);
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panelRef = useRef(null);

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!dragging.current) return;
      setPosition({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    };
    const onMouseUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const onHeaderMouseDown = (e) => {
    if (e.target.tagName === "BUTTON") return;
    dragging.current = true;
    const rect = panelRef.current.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) handleImageFile(item.getAsFile());
    }
  };

  const handleFileChange = (e) => {
    Array.from(e.target.files || []).forEach((file) => handleImageFile(file));
    e.target.value = "";
  };

  return (
    <div className="chatbot-wrapper">
      {isOpen && (
        <div
          ref={panelRef}
          className={`chatbot-panel ${isExpanded ? "chatbot-panel--expanded" : ""}`}
          style={{ position: "fixed", left: position.x, top: position.y }}
        >
          <div className="chatbot-header" onMouseDown={onHeaderMouseDown}>
            <span>المساعد الذكي</span>
            <div className="chatbot-header-actions">
              <button onClick={() => setIsExpanded(!isExpanded)} title={isExpanded ? "تصغير" : "تكبير"}>
                {isExpanded ? "⊡" : "⊞"}
              </button>
              <button onClick={() => { setIsOpen(false); setIsExpanded(false); }}>✕</button>
            </div>
          </div>

          <div className="chatbot-messages">
            {messages.map((msg, i) => (
              <div key={i} className={msg.sender === "user" ? "chatbot-bubble-user" : "chatbot-bubble-bot"}>
                {msg.images?.length > 0 && (
                  <div className="chatbot-images-row">
                    {msg.images.map((src, j) => (
                      <img key={j} src={src} alt="uploaded" className="chatbot-image-preview" />
                    ))}
                  </div>
                )}
                {msg.sender === "user"
                  ? msg.text
                  : <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>}
              </div>
            ))}

            {messages.length === 1 && config.suggestions && (
              <div className="chatbot-suggestions">
                {config.suggestions.map((s, i) => (
                  <button key={i} onClick={() => setInput(s)}>{s}</button>
                ))}
              </div>
            )}

            <div ref={messagesEndRef} />
            {loading && <p className="chatbot-loading">جاري الإرسال...</p>}
          </div>

          {images.length > 0 && (
            <div className="chatbot-image-attach">
              {images.map((img, i) => (
                <div key={i} className="chatbot-image-attach-item">
                  <img src={img.preview} alt="preview" />
                  <button onClick={() => removeImage(i)}>✕</button>
                </div>
              ))}
            </div>
          )}

          <form className="chatbot-input-row" onSubmit={(e) => { e.preventDefault(); sendMessage(); }}>
            <button type="button" className="chatbot-attach-btn" onClick={() => fileInputRef.current?.click()} title="إرفاق صورة">
              📎
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleFileChange} />
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onPaste={handlePaste} placeholder={config.placeholder} />
            <button type="submit">إرسال</button>
          </form>
        </div>
      )}

      <button className="chatbot-toggle" onClick={() => setIsOpen(!isOpen)}>
        💬
      </button>
    </div>
  );
}
