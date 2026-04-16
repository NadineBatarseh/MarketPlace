import { useState, useRef, useEffect } from "react";
import supabase from "../../lib/supabase";

async function sendToAssistant(message, role) {
  // Pass the current session token so write tools can authenticate
  const { data: { session } } = await supabase.auth.getSession();
  const sb_auth_token = session?.access_token ?? undefined;

  const res = await fetch("http://localhost:4000/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, role, sb_auth_token }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error);
  return data.reply;
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
      const reply = await sendToAssistant(currentInput, role);
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
