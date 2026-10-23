import type { ComponentProps, ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as RadixPopover from '@radix-ui/react-popover';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { useAdminPortal } from './portal';

/** Dropdown menu (account, row "More" menus): Radix underneath for roving focus, typeahead
 * and Escape; skinned with the admin tokens. */
export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({ children, align = 'end', ...rest }: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal container={useAdminPortal()}>
      <DropdownMenu.Content className="adm-pop adm-menu" align={align} sideOffset={8} {...rest}>
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

export function MenuItem({ className, ...rest }: ComponentProps<typeof DropdownMenu.Item>) {
  return <DropdownMenu.Item className={className ? `adm-menu__item ${className}` : 'adm-menu__item'} {...rest} />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="adm-menu__label">{children}</DropdownMenu.Label>;
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="adm-menu__sep" />;
}

/** Non-modal floating panel anchored to a trigger (filters, quick editors). */
export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;

export function PopoverContent({ children, align = 'end', ...rest }: ComponentProps<typeof RadixPopover.Content>) {
  return (
    <RadixPopover.Portal container={useAdminPortal()}>
      <RadixPopover.Content className="adm-pop" align={align} sideOffset={8} {...rest}>
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  );
}

/** A short hint on hover and keyboard focus. Never the only place information lives. */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  const container = useAdminPortal();
  return (
    <RadixTooltip.Provider delayDuration={400}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal container={container}>
          <RadixTooltip.Content className="adm-tooltip" sideOffset={6}>{content}</RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
