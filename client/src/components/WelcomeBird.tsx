import { useEffect, useState } from 'react';

interface WelcomeBirdProps {
  onComplete: () => void;
}

export default function WelcomeBird({ onComplete }: WelcomeBirdProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // 1. Fade IN: Trigger shortly after mounting
    const fadeInTimer = setTimeout(() => {
      setIsVisible(true);
    }, 100);

    // 2. Fade OUT: Start fading out at 1.8 seconds
    const fadeOutTimer = setTimeout(() => {
      setIsVisible(false);
    }, 1800);

    // 3. COMPLETE: Unmount at exactly 2.5 seconds (1800ms + 700ms transition)
    const completeTimer = setTimeout(() => {
      onComplete();
    }, 2500);
    
    return () => {
      clearTimeout(fadeInTimer);
      clearTimeout(fadeOutTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <div 
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-xl transition-opacity duration-700 ease-in-out ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="text-center px-4 flex flex-col items-center">
        <img 
          src="/bird.gif" 
          alt="Cute flying bird" 
          className="w-64 h-64 mb-8 object-contain drop-shadow-2xl" 
        /> 

        <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight mb-4">
          Welcome to Transcenda<span className="text-blue-500">.</span>
        </h1>
        
        <p className="text-blue-400 font-medium text-lg tracking-wider uppercase drop-shadow-md">
          For all your kuku vacation needs
        </p>
      </div>
    </div>
  );
}