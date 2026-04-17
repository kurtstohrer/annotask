// Fixture: mimics the single flat `dist/index.d.ts` produced by bundlers like tsup/rollup
// for libraries that publish only `dist/` (no per-component subdirs, no per-component .d.ts).
// Interfaces are declared without `export` — the package has a separate export block elsewhere.
// This is the shape that broke extraction for github.com/kurtstohrer/annotask#24.

/// <reference types="react" />

interface AccordionProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Body content of the accordion */
    children: React.ReactNode;
    /** Any additional classes to apply */
    className?: string;
    /** Should the accordion be expanded? */
    expanded?: boolean;
}

interface AccordionGroupProps {
    /** Grouped accordion items */
    children: React.ReactNode;
    className?: string;
    /**
     * Allow multiple accordions open at once.
     * @defaultValue false
     */
    multiselect?: boolean;
    onToggle?: (index: number) => void;
    fullWidth?: boolean;
}

declare function Accordion({ children, className, expanded, ...props }: AccordionProps): JSX.Element;
declare function AccordionGroup({ children, className, multiselect, onToggle, fullWidth, ...props }: AccordionGroupProps): JSX.Element;

interface AdvancedTableProps<T = unknown> {
    rows: T[];
    columns: number;
}

declare function AdvancedTable<T>({ rows, columns }: AdvancedTableProps<T>): JSX.Element;

export { Accordion, AccordionGroup, AdvancedTable };
