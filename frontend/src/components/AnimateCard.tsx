import { motion, useReducedMotion } from "framer-motion";

interface Props {
  children: React.ReactNode;
  className?: string;
  /** DOM id — lets callers scroll/anchor to a specific card. */
  id?: string;
  delay?: number;
  hoverScale?: number;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  /** Inline style, for things the className can't express — e.g. a per-card
   *  animation-delay used to stagger a CSS keyframe across a grid. */
  style?: React.CSSProperties;
}

// Snappy entrance: short fade + tiny rise. The incoming stagger `delay` is hard
// capped so large grids (38+ truck cards) finish appearing in ~0.25s instead of
// cascading for over a second, and re-rendering a card (e.g. marking it unloaded)
// doesn't feel laggy. Honors the OS "reduce motion" setting.
const MAX_STAGGER = 0.08;

export default function AnimateCard({ children, className, id, delay = 0, hoverScale = 1.02, onClick, style }: Props) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return (
      <div id={id} className={className} style={style} onClick={onClick}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      id={id}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.14, delay: Math.min(delay, MAX_STAGGER), ease: "easeOut" }}
      whileHover={{ scale: hoverScale }}
      className={className}
      style={style}
      onClick={onClick}
    >
      {children}
    </motion.div>
  );
}
