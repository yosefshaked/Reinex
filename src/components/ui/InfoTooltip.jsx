import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

const InfoTooltip = ({ message }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef(null);

  const updatePosition = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        top: rect.top,
        left: rect.left + rect.width / 2,
      });
    }
  };

  useEffect(() => {
    if (isHovered) {
      updatePosition();
      // Update position on scroll and resize
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
      
      return () => {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    }
  }, [isHovered]);

  return (
    <>
      <span className="inline-flex">
        <button
          ref={buttonRef}
          type="button"
          className="flex h-[25px] w-[25px] items-center justify-center rounded-full border-0 bg-gradient-to-br from-blue-400 to-blue-700 shadow-[0_5px_5px_rgba(0,0,0,0.151)]"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          aria-label={message || 'מידע נוסף'}
        >
          <svg className="h-3 fill-white transition-transform hover:animate-[jello-vertical_0.7s_both]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512">
            <path d="M80 160c0-35.3 28.7-64 64-64h32c35.3 0 64 28.7 64 64v3.6c0 21.8-11.1 42.1-29.4 53.8l-42.2 27.1c-25.2 16.2-40.4 44.1-40.4 74V320c0 17.7 14.3 32 32 32s32-14.3 32-32v-1.4c0-8.2 4.2-15.8 11-20.2l42.2-27.1c36.6-23.6 58.8-64.1 58.8-107.7V160c0-70.7-57.3-128-128-128H144C73.3 32 16 89.3 16 160c0 17.7 14.3 32 32 32s32-14.3 32-32zm80 320a40 40 0 1 0 0-80 40 40 0 1 0 0 80z" />
          </svg>
        </button>
      </span>
      {isHovered &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[99999] mt-[-10px] max-w-[250px] translate-x-[-50%] translate-y-[-100%] rounded bg-gradient-to-br from-blue-400 to-blue-700 px-2 py-1 text-center text-xs text-white shadow-[0_5px_10px_rgba(0,0,0,0.2)] before:absolute before:bottom-[-4px] before:left-1/2 before:h-2 before:w-2 before:translate-x-[-50%] before:rotate-45 before:bg-blue-700 before:content-['']"
            style={{ top: position.top - 40, left: position.left }}
          >
            {message}
          </div>,
          document.body
        )}
    </>
  );
};

export default InfoTooltip;
