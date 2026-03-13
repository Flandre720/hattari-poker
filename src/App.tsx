import { useCallback, useEffect } from 'react';
import './index.css';
import { useSocket } from './core/useSocket';
import { useToast } from './core/useToast';
import { useSoundEffects } from './core/useSoundEffects';
import { SecretModeProvider, useSecretMode } from './core/SecretModeContext';
import { SettingsProvider, useSettings } from './core/SettingsContext';
import { LobbyScreen } from './components/LobbyScreen';
import { OnlineGameBoard } from './components/OnlineGameBoard';
import { OnlineGameOverScreen } from './components/OnlineGameOverScreen';
import { ToastContainer } from './components/ToastContainer';
import { ChatBox } from './components/ChatBox';
import { SettingsButton } from './components/SettingsModal';

function AppInner() {
  const { toasts, addToast } = useToast();
  const { settings } = useSettings();
  const { play: playSound } = useSoundEffects(settings.seVolume / 100);
  const { isSecretMode, activateSecretMode } = useSecretMode();
  const handleSound = useCallback((effect: string) => {
    playSound(effect as Parameters<typeof playSound>[0]);
  }, [playSound]);
  const socket = useSocket(addToast, handleSound);
  const { room, gameState } = socket;

  // サーバーからのたぬきモード伝播
  useEffect(() => {
    if (room?.secretMode && !isSecretMode) {
      activateSecretMode();
    }
  }, [room?.secretMode, isSecretMode, activateSecretMode]);

  // 接続状態インジケーター
  const connectionIndicator = (
    <div className={`connection-status ${socket.connected ? 'connected' : 'disconnected'}`}>
      {socket.connected ? '🟢 接続中' : '🔴 切断中...再接続試行中'}
    </div>
  );

  // 共通オーバーレイ
  const overlays = (
    <>
      <ToastContainer toasts={toasts} />
      {room && <ChatBox messages={socket.chatMessages} onSend={socket.sendChat} myPlayerId={socket.myPlayerId} />}
      {connectionIndicator}
      <SettingsButton onLeaveRoom={room ? socket.leaveRoom : undefined} />
    </>
  );

  // ロビー（ルーム未参加 or 待機中）
  if (!room || room.status === 'WAITING') {
    return (
      <>
        <LobbyScreen
          room={room}
          myPlayerId={socket.myPlayerId}
          connected={socket.connected}
          error={socket.error}
          onCreateRoom={socket.createRoom}
          onJoinRoom={socket.joinRoom}
          onStartGame={socket.startGame}
          onJoinAsSpectator={socket.joinAsSpectator}
          onLeaveRoom={socket.leaveRoom}
        />
        {overlays}
      </>
    );
  }

  // ゲーム終了
  if (gameState && gameState.phase === 'GAME_OVER') {
    return (
      <>
        <OnlineGameOverScreen
          gameState={gameState}
          onRematch={socket.rematch}
          onLeaveRoom={socket.leaveRoom}
        />
        {overlays}
      </>
    );
  }

  // ゲームプレイ中
  if (gameState) {
    return (
      <>
        <OnlineGameBoard
          gameState={gameState}
          selectCard={socket.selectCard}
          challenge={socket.challenge}
          peekCard={socket.peekCard}
          passCard={socket.passCard}
          confirmResult={socket.confirmResult}
          useSkill={socket.useSkill}
          changeSelectTarget={socket.changeSelectTarget}
          salvationSelectTarget={socket.salvationSelectTarget}
        />
        {overlays}
      </>
    );
  }

  // Fallback
  return (
    <div className="lobby-screen">
      <p>⏳ ゲーム状態をサーバーから取得中...</p>
      {overlays}
    </div>
  );
}

function App() {
  return (
    <SettingsProvider>
      <SecretModeProvider>
        <AppInner />
      </SecretModeProvider>
    </SettingsProvider>
  );
}

export default App;
