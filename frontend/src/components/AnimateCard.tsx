import { motion } from "framer-motion";

interface Props {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  hoverScale?: number;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

export default function AnimateCard({ children, className, delay = 0, hoverScale = 1.02, onClick }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      whileHover={{ scale: hoverScale }}
      className={className}
      onClick={onClick}
    >
      {children}
    </motion.div>
  );
}
