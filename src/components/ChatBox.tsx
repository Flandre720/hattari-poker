/**
 * チャットボックスコンポーネント
 * クイックメッセージ + スタンプ + テキスト入力
 */

import { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '../core/useSocket';

const QUICK_MESSAGES = ['ナイス！', 'ドンマイ', 'えっ!?', '待って', 'GG！', '笑'];
const STAMPS = ['👍', '👏', '😂', '😱', '🤔', '💀', '🔥', '🎉', '😎', '🤯', '🥲', '✌️'];

/** スタンプ判定: 単一絵文字かどうか */
function isStampMessage(msg: string): boolean {
  return STAMPS.includes(msg.trim());
}

interface ChatBoxProps {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  myPlayerId: string | null;
}

export function ChatBox({ messages, onSend, myPlayerId }: ChatBoxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [showStamps, setShowStamps] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(messages.length);

  // 新メッセージ時の未読カウント更新
  useEffect(() => {
    if (messages.length > prevLengthRef.current && !isOpen) {
      setUnreadCount(prev => prev + (messages.length - prevLengthRef.current));
    }
    prevLengthRef.current = messages.length;
  }, [messages.length, isOpen]);

  // 開いた時に未読リセット
  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0);
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, messages.length]);

  const handleSend = () => {
    const msg = input.trim();
    if (!msg) return;
    onSend(msg);
    setInput('');
  };

  const handleQuickSend = (msg: string) => {
    onSend(msg);
  };

  const handleStampSend = (stamp: string) => {
    onSend(stamp);
    setShowStamps(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div className={`chat-box ${isOpen ? 'chat-open' : 'chat-closed'}`}>
      <button
        className="chat-toggle"
        onClick={() => setIsOpen(!isOpen)}
      >
        💬 {isOpen ? '閉じる' : 'チャット'}
        {!isOpen && unreadCount > 0 && (
          <span className="chat-badge">{unreadCount}</span>
        )}
      </button>

      {isOpen && (
        <div className="chat-body">
          <div className="chat-messages">
            {messages.length === 0 && (
              <p className="chat-empty">メッセージはまだありません</p>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`chat-msg ${msg.playerId === myPlayerId ? 'chat-msg-mine' : ''} ${isStampMessage(msg.message) ? 'chat-msg-stamp' : ''}`}
              >
                <span className="chat-msg-name">{msg.playerName}</span>
                {isStampMessage(msg.message) ? (
                  <span className="chat-msg-stamp-emoji">{msg.message}</span>
                ) : (
                  <span className="chat-msg-text">{msg.message}</span>
                )}
                <span className="chat-msg-time">{formatTime(msg.timestamp)}</span>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* クイックメッセージバー */}
          <div className="quick-msg-bar">
            {QUICK_MESSAGES.map(msg => (
              <button
                key={msg}
                className="quick-msg-btn"
                onClick={() => handleQuickSend(msg)}
              >
                {msg}
              </button>
            ))}
          </div>

          {/* スタンプパネル */}
          {showStamps && (
            <div className="stamp-panel">
              {STAMPS.map(stamp => (
                <button
                  key={stamp}
                  className="stamp-btn"
                  onClick={() => handleStampSend(stamp)}
                >
                  {stamp}
                </button>
              ))}
            </div>
          )}

          <div className="chat-input-area">
            <button
              className={`stamp-toggle ${showStamps ? 'active' : ''}`}
              onClick={() => setShowStamps(!showStamps)}
              title="スタンプ"
            >
              😀
            </button>
            <input
              className="chat-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="メッセージを入力..."
              maxLength={50}
            />
            <button className="chat-send-btn" onClick={handleSend} disabled={!input.trim()}>
              送信
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
