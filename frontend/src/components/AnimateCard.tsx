import { motion, useReducedMotion } from "framer-motion";

interface Props {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  hoverScale?: number;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

// Snappy entrance: short fade + tiny rise. The incoming stagger `delay` is hard
// capped so large grids (38+ truck cards) finish appearing in ~0.25s instead of
// cascading for over a second, and re-rendering a card (e.g. marking it unloaded)
// doesn't feel laggy. Honors the OS "reduce motion" setting.
const MAX_STAGGER = 0.08;

export default function AnimateCard({ children, className, delay = 0, hoverScale = 1.02, onClick }: Props) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return (
      <div className={className} onClick={onClick}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.14, delay: Math.min(delay, MAX_STAGGER), ease: "easeOut" }}
      whileHover={{ scale: hoverScale }}
      className={className}
      onClick={onClick}
    >
      {children}
    </motion.div>
  );
}
