
import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  delay?: number;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children, position = 'top', className = '', delay = 200 }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);

  const updatePosition = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      
      let top = 0;
      let left = 0;

      switch (position) {
        case 'top':
          top = rect.top - 8;
          left = rect.left + rect.width / 2;
          break;
        case 'bottom':
          top = rect.bottom + 8;
          left = rect.left + rect.width / 2;
          break;
        case 'left':
          top = rect.top + rect.height / 2;
          left = rect.left - 8;
          break;
        case 'right':
          top = rect.top + rect.height / 2;
          left = rect.right + 8;
          break;
      }
      setCoords({ top, left });
    }
  };

  const handleMouseEnter = () => {
    timerRef.current = window.setTimeout(() => {
        updatePosition();
        setIsVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
    }
    setIsVisible(false);
  };

  return (
    <>
      <div 
        ref={triggerRef}
        className={`inline-flex ${className}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </div>
      {isVisible && createPortal(
        <div 
          className="fixed z-[9999] px-3 py-1.5 text-xs font-medium text-white bg-slate-900/90 backdrop-blur-sm border border-slate-700/50 rounded-lg shadow-xl pointer-events-none animate-fade-in whitespace-nowrap select-none"
          style={{
            top: coords.top,
            left: coords.left,
            transform: 
              position === 'top' ? 'translate(-50%, -100%)' :
              position === 'bottom' ? 'translate(-50%, 0)' :
              position === 'left' ? 'translate(-100%, -50%)' :
              'translate(0, -50%)'
          }}
        >
          {content}
        </div>,
        document.body
      )}
    </>
  );
};
