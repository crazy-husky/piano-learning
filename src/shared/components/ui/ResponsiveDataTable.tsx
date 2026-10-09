import { Fragment, type CSSProperties, type ReactNode } from "react";

export interface ResponsiveDataTableColumn<Row> {
  align?: CSSProperties["textAlign"];
  className?: string;
  getCellClassName?: (row: Row, rowIndex: number) => string | undefined;
  header: ReactNode;
  headerClassName?: string;
  id: string;
  maxWidth?: CSSProperties["maxWidth"];
  minWidth?: CSSProperties["minWidth"];
  mobileLabel?: string;
  renderCell: (row: Row, rowIndex: number) => ReactNode;
  rowHeader?: boolean;
  width?: CSSProperties["width"];
}

interface ResponsiveDataTableProps<Row> {
  ariaLabel: string;
  className?: string;
  columns: readonly ResponsiveDataTableColumn<Row>[];
  detailsCellClassName?: string;
  detailsRowClassName?: string;
  getRowKey: (row: Row, rowIndex: number) => string | number;
  id?: string;
  minWidth?: CSSProperties["minWidth"];
  renderRowDetails?: (row: Row, rowIndex: number) => ReactNode;
  rowClassName?: (row: Row, rowIndex: number) => string | undefined;
  rows: readonly Row[];
  tableLayout?: CSSProperties["tableLayout"];
  viewportClassName?: string;
}

function joinClassNames(...classNames: Array<string | undefined>): string {
  return classNames.filter(Boolean).join(" ");
}

export function ResponsiveDataTable<Row>({
  ariaLabel,
  className,
  columns,
  detailsCellClassName,
  detailsRowClassName,
  getRowKey,
  id,
  minWidth,
  renderRowDetails,
  rowClassName,
  rows,
  tableLayout = "auto",
  viewportClassName,
}: ResponsiveDataTableProps<Row>): JSX.Element {
  return (
    <div
      aria-label={ariaLabel}
      className={joinClassNames("ui-data-table-scroll", viewportClassName)}
      id={id}
      role="region"
      tabIndex={0}
    >
      <table
        className={joinClassNames("ui-data-table", className)}
        style={{ minWidth, tableLayout }}
      >
        <colgroup>
          {columns.map((column) => (
            <col
              key={column.id}
              style={{
                maxWidth: column.maxWidth,
                minWidth: column.minWidth,
                width: column.width,
              }}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                className={column.headerClassName}
                key={column.id}
                scope="col"
                style={{ textAlign: column.align }}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            const details = renderRowDetails?.(row, rowIndex);
            const rowKey = getRowKey(row, rowIndex);
            return (
              <Fragment key={rowKey}>
                <tr className={rowClassName?.(row, rowIndex)}>
                  {columns.map((column) => {
                    const Cell = column.rowHeader ? "th" : "td";
                    return (
                      <Cell
                        className={joinClassNames(column.className, column.getCellClassName?.(row, rowIndex))}
                        data-mobile-label={column.mobileLabel ?? (typeof column.header === "string" ? column.header : undefined)}
                        key={column.id}
                        scope={column.rowHeader ? "row" : undefined}
                        style={{ textAlign: column.align }}
                      >
                        {column.renderCell(row, rowIndex)}
                      </Cell>
                    );
                  })}
                </tr>
                {details !== null && details !== undefined && details !== false ? (
                  <tr className={joinClassNames("ui-data-table-details-row", detailsRowClassName)}>
                    <td className={joinClassNames("ui-data-table-details-cell", detailsCellClassName)} colSpan={columns.length}>
                      {details}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
