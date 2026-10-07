"use client";

import { Children, isValidElement, type ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../common/ui/select";

/** Declarative options rendered through the workspace's keyboard-accessible glass menu. */
export function PublishingSelect({
  value,
  onValueChange,
  children,
  disabled,
  className,
  "aria-label": label,
}: {
  value: string | number;
  onValueChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const options = Children.toArray(children)
    .filter(isValidElement<{ value?: string | number; children?: ReactNode }>)
    .map((child) => ({
      value: String(child.props.value ?? child.props.children),
      label: child.props.children,
    }));
  return (
    <Select
      value={String(value)}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      items={options}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={label}
        className={className ?? "w-full min-w-0"}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
