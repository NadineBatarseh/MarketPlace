import { useState } from "react";
import { chatbotConfig } from "./chatbotConfig";
import { useChatbot } from "./useChatbot";
import "./ChatBot.css";

export default function ChatBot({ role = "merchant" }) {
  const config = chatbotConfig[role];
  const { messages, input, setInput, loading, sendMessage, messagesEndRef } =
    useChatbot(role, config);
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="chatbot-wrapper">
      {isOpen && (
        <div className="chatbot-panel">
          <div className="chatbot-header">
            <span>المساعد الذكي</span>
            <button onClick={() => setIsOpen(false)}>✕</button>
          </div>

          <div className="chatbot-messages">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={
                  msg.sender === "user"
                    ? "chatbot-bubble-user"
                    : "chatbot-bubble-bot"
                }
              >
                {msg.text}
              </div>
            ))}

            {messages.length === 1 && config.suggestions && (
              <div className="chatbot-suggestions">
                {config.suggestions.map((s, i) => (
                  <button key={i} onClick={() => setInput(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div ref={messagesEndRef} />
            {loading && <p className="chatbot-loading">جاري الإرسال...</p>}
          </div>

          <form
            className="chatbot-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={config.placeholder}
            />
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
