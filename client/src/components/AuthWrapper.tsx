import React, { ReactNode } from 'react';

interface AuthWrapperProps {
  children: ReactNode;
}

export function AuthWrapper({ children }: AuthWrapperProps) {
  // Simply render the children without any authentication requirements
  return (
    <div>
      {children}
    </div>
  );
} 