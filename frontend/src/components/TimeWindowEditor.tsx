import React from 'react';

interface TimeWindowEditorProps {
  enabled: boolean;
  start: string;
  end: string;
  days: number[];
  onToggle: (v: boolean) => void;
  onChangeStart: (v: string) => void;
  onChangeEnd: (v: string) => void;
  onChangeDays: (v: number[]) => void;
}

export function TimeWindowEditor({
  enabled, start, end, days,
  onToggle, onChangeStart, onChangeEnd, onChangeDays
}: TimeWindowEditorProps) {
  const dayOptions = [
    { label: '一', value: 1 },
    { label: '二', value: 2 },
    { label: '三', value: 3 },
    { label: '四', value: 4 },
    { label: '五', value: 5 },
    { label: '六', value: 6 },
    { label: '日', value: 0 },
  ];

  const toggleDay = (day: number) => {
    if (days.includes(day)) {
      onChangeDays(days.filter(d => d !== day));
    } else {
      onChangeDays([...days, day].sort((a, b) => a - b));
    }
  };

  return (
    <div className="border border-gray-200 rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm">⏰</span>
          <span className="text-sm font-bold text-gray-700">使用时间限制</span>
        </div>
        <button
          onClick={() => onToggle(!enabled)}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            enabled ? 'bg-indigo-500' : 'bg-gray-300'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
              enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
      
      {enabled && (
        <div className="space-y-3 animate-in fade-in">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[11px] text-gray-500 font-bold block mb-1">开始时间</label>
              <input
                type="time"
                value={start}
                onChange={e => onChangeStart(e.target.value)}
                className="w-full p-2 rounded-lg border bg-gray-50 text-sm"
              />
            </div>
            <div className="flex-1">
              <label className="text-[11px] text-gray-500 font-bold block mb-1">结束时间</label>
              <input
                type="time"
                value={end}
                onChange={e => onChangeEnd(e.target.value)}
                className="w-full p-2 rounded-lg border bg-gray-50 text-sm"
              />
            </div>
          </div>
          
          <div>
            <label className="text-[11px] text-gray-500 font-bold block mb-1">可用星期</label>
            <div className="flex gap-1.5">
              {dayOptions.map(d => (
                <button
                  key={d.value}
                  onClick={() => toggleDay(d.value)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    days.includes(d.value)
                      ? 'bg-indigo-500 text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          
          <p className="text-[11px] text-gray-400">
            💡 开启后，孩子只能在设定的时间范围内兑现/使用此道具
          </p>
        </div>
      )}
    </div>
  );
}
