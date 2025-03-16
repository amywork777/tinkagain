import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from '@/context/AuthContext';
import { Lock } from 'lucide-react';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LoginModal({ isOpen, onClose }: LoginModalProps) {
  const { login } = useAuth();

  const handleContinue = () => {
    // Just close the dialog without signing in
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <div className="absolute -z-10 inset-0 bg-gradient-to-tr from-primary/5 to-secondary/5 rounded-lg" />
        
        <DialogHeader className="space-y-3">
          <div className="mx-auto bg-primary/10 p-3 rounded-full w-fit">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-xl text-center">Welcome to FishCAD</DialogTitle>
          <DialogDescription className="text-center px-4">
            Continue to use FishCAD without an account
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex flex-col gap-6 py-6">
          <div className="flex justify-center">
            <Button 
              onClick={handleContinue} 
              className="w-full sm:w-auto flex items-center justify-center gap-2"
            >
              Continue to FishCAD
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
} 