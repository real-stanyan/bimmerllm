// components/sidebar/ThreadGroup.tsx
import { I, type IconName } from "@/components/ui/icons";

interface Props {
  label: string;
  icon?: IconName;
  children: React.ReactNode;
}

export function ThreadGroup({ label, icon, children }: Props) {
  const Icon = icon ? I[icon] : null;
  return (
    <div className="mb-3.5">
      <div className="flex items-center gap-1.5 px-2 pb-1.5 text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-wider font-mono">
        {Icon && <Icon size={11} />}
        <span>{label}</span>
      </div>
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  );
}
