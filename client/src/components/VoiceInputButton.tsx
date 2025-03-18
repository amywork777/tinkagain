import React from 'react';
import { useSpeechRecognition } from './utils/SpeechRecognitionProvider';
import { MdMic, MdMicOff } from 'react-icons/md';

interface VoiceInputButtonProps {
  onTranscriptChange?: (transcript: string) => void;
  buttonSize?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const VoiceInputButton: React.FC<VoiceInputButtonProps> = ({
  onTranscriptChange,
  buttonSize = 'md',
  className = '',
}) => {
  const { isListening, transcript, startListening, stopListening, clearTranscript, error } = useSpeechRecognition();

  // Send transcript to parent component when it changes
  React.useEffect(() => {
    if (onTranscriptChange && transcript) {
      onTranscriptChange(transcript);
    }
  }, [transcript, onTranscriptChange]);

  const handleToggleListen = () => {
    if (isListening) {
      stopListening();
    } else {
      clearTranscript();
      startListening();
    }
  };

  // Determine size classes based on buttonSize prop
  const sizeClasses = {
    sm: 'p-2 text-sm',
    md: 'p-3 text-base',
    lg: 'p-4 text-lg',
  }[buttonSize];

  // Icon size based on button size
  const iconSize = {
    sm: 16,
    md: 20,
    lg: 24,
  }[buttonSize];

  return (
    <div className="relative">
      <button
        onClick={handleToggleListen}
        className={`rounded-full ${isListening ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'} 
                   text-white transition-colors ${sizeClasses} ${className}`}
        title={isListening ? 'Stop voice input' : 'Start voice input'}
        aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
      >
        {isListening ? <MdMicOff size={iconSize} /> : <MdMic size={iconSize} />}
      </button>
      
      {error && (
        <div className="absolute bottom-full mb-2 right-0 bg-red-100 text-red-700 p-2 rounded-md text-xs whitespace-nowrap">
          {error}
        </div>
      )}
    </div>
  );
};

export default VoiceInputButton; 