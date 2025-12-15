import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';

const InfoTooltip = ({ message, side = 'top' }) => {
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
      <StyledWrapper>
        <button
          ref={buttonRef}
          className="info-button"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512">
            <path d="M80 160c0-35.3 28.7-64 64-64h32c35.3 0 64 28.7 64 64v3.6c0 21.8-11.1 42.1-29.4 53.8l-42.2 27.1c-25.2 16.2-40.4 44.1-40.4 74V320c0 17.7 14.3 32 32 32s32-14.3 32-32v-1.4c0-8.2 4.2-15.8 11-20.2l42.2-27.1c36.6-23.6 58.8-64.1 58.8-107.7V160c0-70.7-57.3-128-128-128H144C73.3 32 16 89.3 16 160c0 17.7 14.3 32 32 32s32-14.3 32-32zm80 320a40 40 0 1 0 0-80 40 40 0 1 0 0 80z" />
          </svg>
        </button>
      </StyledWrapper>
      {isHovered &&
        typeof document !== 'undefined' &&
        createPortal(
          <TooltipPortal style={{ top: position.top - 40, left: position.left }}>
            {message}
          </TooltipPortal>,
          document.body
        )}
    </>
  );
};

const StyledWrapper = styled.div`
  display: inline-flex;
  
  .info-button {
    width: 25px;
    height: 25px;
    border-radius: 50%;
    border: none;
    background-color: #60a5fa;
    background-image: linear-gradient(147deg, #60a5fa 0%, #2563eb 74%);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: default;
    box-shadow: 0px 5px 5px rgba(0, 0, 0, 0.151);
    position: relative;
  }
  
  .info-button svg {
    height: 0.75em;
    fill: white;
    transition: transform 0.3s;
  }
  
  .info-button:hover svg {
    animation: jello-vertical 0.7s both;
  }
  
  @keyframes jello-vertical {
    0% {
      transform: scale3d(1, 1, 1);
    }
    30% {
      transform: scale3d(0.75, 1.25, 1);
    }
    40% {
      transform: scale3d(1.25, 0.75, 1);
    }
    50% {
      transform: scale3d(0.85, 1.15, 1);
    }
    65% {
      transform: scale3d(1.05, 0.95, 1);
    }
    75% {
      transform: scale3d(0.95, 1.05, 1);
    }
    100% {
      transform: scale3d(1, 1, 1);
    }
  }
`;

const TooltipPortal = styled.div`
  position: fixed;
  transform: translate(-50%, -100%);
  margin-top: -10px;
  background-color: #60a5fa;
  background-image: linear-gradient(147deg, #60a5fa 0%, #2563eb 74%);
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  max-width: 250px;
  white-space: normal;
  word-wrap: break-word;
  text-align: center;
  z-index: 99999;
  pointer-events: none;
  box-shadow: 0px 5px 10px rgba(0, 0, 0, 0.2);
  
  &::before {
    content: "";
    position: absolute;
    bottom: -4px;
    left: 50%;
    transform: translateX(-50%) rotate(45deg);
    width: 8px;
    height: 8px;
    background-color: #2563eb;
  }
`;

export default InfoTooltip;
