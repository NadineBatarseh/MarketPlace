import { useState, useRef, useEffect } from "react";

async function sendToAssistant(message, role, allowedTools) {
  // placeholder — will connect to MCP later
  return `وصلتني رسالتك: "${message}" (الدور: ${role})`;
}

export function useChatbot(role, config) {
  const [messages, setMessages] = useState([
    { sender: "bot", text: config.welcomeMessage },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim()) return;

    const currentInput = input;
    setMessages((prev) => [...prev, { sender: "user", text: currentInput }]);
    setInput("");
    setLoading(true);

    try {
      const reply = await sendToAssistant(currentInput, role, config.allowedTools);
      setMessages((prev) => [...prev, { sender: "bot", text: reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { sender: "bot", text: "حدث خطأ، حاول مرة أخرى." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return { messages, input, setInput, loading, sendMessage, messagesEndRef };
}
