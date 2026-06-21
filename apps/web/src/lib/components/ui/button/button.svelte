<script lang="ts" module>
  import { tv, type VariantProps } from 'tailwind-variants';

  export const buttonVariants = tv({
    base: 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[7px] text-sm font-medium transition-[transform,background-color,color,border-color] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px disabled:pointer-events-none disabled:opacity-50',
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:brightness-110',
        outline: 'border border-border bg-transparent text-foreground hover:border-foreground/40 hover:bg-accent',
        ghost: 'text-muted-foreground hover:bg-accent hover:text-coral',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-7 px-2.5 text-xs',
        icon: 'size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  });

  export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
  export type ButtonSize = VariantProps<typeof buttonVariants>['size'];
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  let {
    variant = 'default',
    size = 'default',
    class: className = undefined,
    children,
    ...rest
  }: HTMLButtonAttributes & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    class?: string;
    children: Snippet;
  } = $props();
</script>

<button class={cn(buttonVariants({ variant, size }), className)} {...rest}>
  {@render children()}
</button>
