import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'accent' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  fullWidth = false,
  className = '', 
  ...props 
}) => {
  const base = "rounded-xl font-bold transition-all active:scale-95 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed";
  
  const variants = {
    primary: "bg-gray-900 text-white shadow-lg hover:bg-gray-800",
    secondary: "bg-white text-gray-900 border-2 border-gray-200 hover:border-gray-300",
    accent: "bg-yellow-400 text-yellow-900 hover:bg-yellow-300",
    danger: "bg-red-100 text-red-600 hover:bg-red-200",
    ghost: "bg-transparent text-gray-500 hover:bg-gray-100"
  };

  const sizes = {
    sm: "px-3 py-1 text-xs",
    md: "px-4 py-3 text-sm",
    lg: "px-6 py-4 text-lg"
  };

  return (
    <button 
      className={`${base} ${variants[variant]} ${sizes[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};

