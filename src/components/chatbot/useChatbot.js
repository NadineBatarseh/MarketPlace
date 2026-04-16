import { useState, useRef, useEffect } from "react";
import supabase from "../../lib/supabase";

async function sendToAssistant(message, role, images, onChunk) {
  const res = await fetch("http://localhost:4000/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, role, images }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));

    for (const line of lines) {
      const data = line.replace("data: ", "").trim();
      if (data === "[DONE]") return fullText;
      try {
        const parsed = JSON.parse(data);
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.text) {
          fullText += parsed.text;
          onChunk(fullText);
        }
      } catch {}
    }
  }
  return fullText;
}

export function useChatbot(role, config) {
  const [messages, setMessages] = useState([
    { sender: "bot", text: config.welcomeMessage },
  ]);
  const [input, setInput] = useState("");
  const [images, setImages] = useState([]); // array of { base64, mediaType, preview }
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleImageFile = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target.result.split(",")[1];
      setImages((prev) => [...prev, { base64, mediaType: file.type, preview: e.target.result }]);
    };
    reader.readAsDataURL(file);
  };

  const removeImage = (index) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const sendMessage = async () => {
    if (!input.trim() && images.length === 0) return;

    const currentInput = input;
    const currentImages = images;

    setMessages((prev) => [
      ...prev,
      { sender: "user", text: currentInput, images: currentImages.map((img) => img.preview) },
    ]);
    setInput("");
    setImages([]);
    setLoading(true);

    try {
      setMessages((prev) => [...prev, { sender: "bot", text: "" }]);

      await sendToAssistant(
        currentInput,
        role,
        currentImages.map((img) => ({ base64: img.base64, mediaType: img.mediaType })),
        (partialText) => {
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { sender: "bot", text: partialText };
            return updated;
          });
        }
      );
    } catch {
      setMessages((prev) => [
        ...prev,
        { sender: "bot", text: "حدث خطأ، حاول مرة أخرى." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return { messages, input, setInput, images, handleImageFile, removeImage, loading, sendMessage, messagesEndRef };
}
