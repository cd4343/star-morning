import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  StoredTimerTask,
  getStoredActiveTasks,
  getTaskRemainingSeconds,
  formatRemainingTimer,
  getChildOverlayRoot,
  getTimerBarWidth,
  getDefaultTimerBarPosition,
  clampTimerBarPosition,
} from '../utils/activeTimerTasks';

// 跨页面的「挑战进行中」浮窗：挑战页内有自己的完整版（可展开计时面板），
// 其余孩子端页面渲染本组件，点击跳回挑战页。拖动期间直接写 style，避免整页重渲染卡顿。
export const GlobalTimerBar: React.FC = () => {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<StoredTimerTask[]>(() => getStoredActiveTasks());
  const [position, setPosition] = useState(getDefaultTimerBarPosition);
  const dragRef = useRef({
    dragging: false,
    moved: false,
    offsetX: 0,
    offsetY: 0,
    startX: 0,
    startY: 0,
    lastPos: null as { x: number; y: number } | null,
  });

  useEffect(() => {
    const tick = window.setInterval(() => setTasks(getStoredActiveTasks()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  if (tasks.length === 0) return null;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = {
      dragging: true,
      moved: false,
      offsetX: e.clientX - position.x,
      offsetY: e.clientY - position.y,
      startX: e.clientX,
      startY: e.clientY,
      lastPos: null,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.dragging) return;
    const distance = Math.abs(e.clientX - dragRef.current.startX) + Math.abs(e.clientY - dragRef.current.startY);
    if (distance > 8) {
      dragRef.current.moved = true;
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    }
    if (!dragRef.current.moved) return;
    const pos = clampTimerBarPosition(e.clientX - dragRef.current.offsetX, e.clientY - dragRef.current.offsetY);
    dragRef.current.lastPos = pos;
    const el = e.currentTarget as HTMLElement;
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current.dragging = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (dragRef.current.lastPos) setPosition(dragRef.current.lastPos);
    window.setTimeout(() => {
      dragRef.current.moved = false;
    }, 0);
  };

  const bar = (
    <div
      className="pointer-events-auto absolute z-[80]"
      style={{ left: position.x, top: position.y, width: getTimerBarWidth(), touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="rounded-2xl bg-slate-950 text-white shadow-2xl shadow-slate-900/30 cursor-grab active:cursor-grabbing overflow-hidden">
        <div className="flex items-center justify-between px-3 pt-2 pb-1 text-[10px] font-black text-white/50">
          <span>{tasks.length > 1 ? `${tasks.length} 个挑战进行中` : '挑战进行中'}</span>
          <span>点按回到挑战 · 可拖动</span>
        </div>
        <div className="space-y-1 p-1.5 pt-0">
          {tasks.map(task => (
            <button
              key={task.id}
              type="button"
              aria-label={`回到挑战页查看${task.title || '任务'}`}
              onClick={() => {
                if (dragRef.current.moved) return;
                navigate('/child/challenge');
              }}
              className="w-full rounded-xl bg-white/5 px-2 py-2 active:bg-white/10"
            >
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center text-lg flex-shrink-0">
                  {task.icon || '✅'}
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <div className="text-[10px] font-bold text-white/55 leading-tight">进行中</div>
                  <div className="text-sm font-black truncate leading-tight">{task.title}</div>
                </div>
                <div className={`font-mono text-sm font-black tabular-nums flex-shrink-0 ${getTaskRemainingSeconds(task) < 0 ? 'text-rose-300' : 'text-white'}`}>
                  {formatRemainingTimer(task)}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const root = getChildOverlayRoot();
  return root ? createPortal(bar, root) : bar;
};
