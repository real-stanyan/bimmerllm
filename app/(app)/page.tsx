// app/page.tsx

"use client";

import { useState, useRef, useEffect } from "react";
import { FaUser } from "react-icons/fa";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChat } from "@/components/chat-provider";

interface Message {
  role: "user" | "model";
  content: string;
}

export default function ChatPage() {
  const { activeConversation, updateActiveConversation } = useChat();
  const messages: Message[] = activeConversation?.messages ?? [];

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading || !activeConversation) return;

    const userMsg: Message = { role: "user", content: input };
    const newMessages = [...messages, userMsg];

    // 写入当前会话
    updateActiveConversation((conv) => ({
      ...conv,
      messages: newMessages,
      // 简单规则：用第一条 user 消息做标题
      title:
        conv.messages.length === 0
          ? input.slice(0, 30) || "New chat"
          : conv.title,
    }));

    const payloadMessages = newMessages;
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payloadMessages }),
      });

      if (!res.body) {
        throw new Error("No response body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");

      // 先插入一个空的 AI 消息
      updateActiveConversation((conv) => ({
        ...conv,
        messages: [...conv.messages, { role: "model", content: "" }],
      }));

      let done = false;
      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });

          updateActiveConversation((conv) => {
            if (conv.messages.length === 0) return conv;
            const last = conv.messages[conv.messages.length - 1];
            if (last.role !== "model") return conv;

            const updatedMessages = [...conv.messages];
            updatedMessages[updatedMessages.length - 1] = {
              ...last,
              content: last.content + chunk,
            };
            return { ...conv, messages: updatedMessages };
          });
        }
      }
    } catch (e) {
      console.error(e);
      updateActiveConversation((conv) => ({
        ...conv,
        messages: [
          ...conv.messages,
          { role: "model", content: "请求出错，请稍后重试。" },
        ],
      }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex flex-col w-full h-svh bg-background text-foreground">
      {/* 顶部标题 */}
      <div className="p-8 flex justify-between items-center">
        <h1 className="text-xl font-bold">bimmerllm v0.1</h1>
        <div className="flex justify-center items-center gap-2">
          <h3>username</h3>
          <div className="w-8 h-8 flex justify-center items-center rounded-full bg-foreground">
            <FaUser className="text-background" />
          </div>
        </div>
      </div>

      {/* 聊天区域 */}
      <div className="flex-1 overflow-y-auto p-8 space-y-4 scrollbar-thin scrollbar-thumb-gray-300 pb-32">
        {messages.length === 0 && !loading && (
          <div className="text-center text-gray-400 mt-20">
            ask me anything about BMW cars!
          </div>
        )}

        {messages.map((msg, index) => (
          <div
            key={index}
            className={`flex ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-md leading-relaxed ${
                msg.role === "user"
                  ? "bg-decoration text-text rounded-br-none"
                  : "bg-foreground text-background border border-gray-200 shadow-sm rounded-bl-none"
              }`}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  ul: ({ children }) => (
                    <ul className="list-disc list-outside ml-4 mb-2">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-decimal list-outside ml-4 mb-2">
                      {children}
                    </ol>
                  ),
                  h1: ({ children }) => (
                    <h1 className="text-lg font-bold mb-2 mt-2">{children}</h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-base font-bold mb-2 mt-2">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-sm font-bold mb-1 mt-1">{children}</h3>
                  ),
                  p: ({ children }) => (
                    <p className="mb-2 last:mb-0">{children}</p>
                  ),
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline break-all"
                    >
                      {children}
                    </a>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-4 border-gray-400 pl-3 my-2 italic opacity-80">
                      {children}
                    </blockquote>
                  ),
                  code: ({ children }) => (
                    <code className="bg-gray-500/20 rounded px-1.5 py-0.5 font-mono text-xs mx-1">
                      {children}
                    </code>
                  ),
                  pre: ({ children }) => (
                    <pre className="bg-gray-800/90 text-gray-100 p-3 rounded-lg overflow-x-auto my-2 text-xs">
                      {children}
                    </pre>
                  ),
                  table: ({ children }) => (
                    <div className="overflow-x-auto my-2">
                      <table className="min-w-full border-collapse border border-gray-500/30 text-left">
                        {children}
                      </table>
                    </div>
                  ),
                  th: ({ children }) => (
                    <th className="border border-gray-500/30 px-2 py-1 font-semibold bg-gray-500/10">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="border border-gray-500/30 px-2 py-1">
                      {children}
                    </td>
                  ),
                }}
              >
                {msg.content}
              </ReactMarkdown>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-200 rounded-full px-4 py-2 text-xs animate-pulse text-gray-600">
              Thinking and retrieving information...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div className="fixed bottom-0 left-64 right-0 flex justify-center px-4 py-3">
        {/* left-64 = 16rem，刚好避开 sidebar */}
        <div className="w-full max-w-2xl">
          <input
            className="w-full bg-background p-4 rounded-full border border-gray-300 focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Enter your question about BMW..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            disabled={loading || !activeConversation}
          />
        </div>
      </div>
    </main>
  );
}
