import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export const Card: React.FC<CardProps> = ({ children, className = "", onClick }) => {
  return (
    <div 
      onClick={onClick} 
      className={`bg-white p-4 rounded-2xl shadow-sm border border-gray-100 ${className} ${onClick ? 'cursor-pointer active:bg-gray-50' : ''}`}
    >
      {children}
    </div>
  );
};

