import React, { createContext, useContext, useState, useEffect } from 'react';
import { demoClock } from '../../shared/kernel/clock';

interface ClockContextType {
  currentTimeIso: string;
  now: string;
  advanceHours: (h: number) => void;
  advanceDays: (d: number) => void;
  resetClock: () => void;
}

const ClockContext = createContext<ClockContextType | undefined>(undefined);

export const ClockProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentTimeIso, setCurrentTimeIso] = useState<string>(demoClock.now());

  useEffect(() => {
    return demoClock.subscribe((newNow) => {
      setCurrentTimeIso(newNow);
    });
  }, []);

  return (
    <ClockContext.Provider
      value={{
        currentTimeIso,
        now: currentTimeIso,
        advanceHours: (h) => demoClock.advanceHours(h),
        advanceDays: (d) => demoClock.advanceDays(d),
        resetClock: () => demoClock.reset(),
      }}
    >
      {children}
    </ClockContext.Provider>
  );
};

export const useClock = () => {
  const context = useContext(ClockContext);
  if (!context) {
    throw new Error('useClock must be used within ClockProvider');
  }
  return context;
};
