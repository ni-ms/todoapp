import Image from "next/image";
import {
  BookOpen,
  Code2,
  Briefcase,
  Brain,
  FlaskConical,
  Heart,
  Dumbbell,
  Music,
  Palette,
  Globe,
  Star,
  Coffee,
  Hash,
  Target,
} from "lucide-react";
const icons = {
  book: BookOpen,
  code: Code2,
  briefcase: Briefcase,
  brain: Brain,
  flask: FlaskConical,
  heart: Heart,
  dumbbell: Dumbbell,
  music: Music,
  palette: Palette,
  globe: Globe,
  star: Star,
  coffee: Coffee,
  hash: Hash,
  target: Target,
};
export function TagIcon({
  icon,
  className = "size-4",
}: {
  icon: string;
  className?: string;
}) {
  if (icon.startsWith("data:image/png;base64,"))
    return (
      <Image
        src={icon}
        alt=""
        width={24}
        height={24}
        unoptimized
        className={`${className} rounded-sm object-contain`}
      />
    );
  const Icon = icons[icon as keyof typeof icons] ?? Hash;
  return <Icon className={className} />;
}
