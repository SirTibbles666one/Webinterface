import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { Trash2, MailOpen, Mail, Folder, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'read', label: 'Read' },
]

/**
 * One toolbar for the list.
 *
 * Bulk actions only exist while something is selected — an always-present row of
 * disabled icons reads as broken furniture. The pager only exists when there is a
 * second page, because "1–6 of 6" with two dead chevrons is furniture too.
 */
export function EmailToolbar({
  pagedUids,
  checkedUids,
  totalFiltered,
  pageStart,
  pageEnd,
  safePage,
  pageCount,
  hasMore,
  groups,
  filterMode = 'all',
  onFilterModeChange,
  onDeleteSelected,
  onMarkSelectedRead,
  onMarkSelectedUnread,
  onMoveSelectedToGroup,
  onPrevPage,
  onNextPage,
  onRefresh,
  refreshing,
}) {
  const selected = checkedUids.size
  const showPager = pageCount > 1 || hasMore

  const action = 'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] transition-colors duration-120'

  return (
    <div className="border-b border-line">
      <div className="mx-auto flex w-full max-w-[1040px] items-center gap-3 px-4 py-1.5">
        <div className="flex w-full items-center gap-3">
      {selected === 0 ? (
        <div className="flex items-center gap-1" role="tablist" aria-label="Filter messages">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filterMode === f.id}
              onClick={() => onFilterModeChange?.(f.id)}
              className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors duration-120 max-sm:min-h-[34px] max-sm:px-3 ${
                filterMode === f.id
                  ? 'bg-secondary text-ink-1'
                  : 'text-ink-3 hover:bg-accent hover:text-ink-2'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <span className="mr-1 mono text-[11.5px] text-ink-2">{selected} selected</span>
          <button
            type="button"
            onClick={onMarkSelectedRead}
            className={`${action} text-ink-2 hover:bg-accent hover:text-ink-1`}
            title="Mark as read"
          >
            <MailOpen className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onMarkSelectedUnread}
            className={`${action} text-ink-2 hover:bg-accent hover:text-ink-1`}
            title="Mark as unread"
          >
            <Mail className="size-3.5" />
          </button>
          {groups.length > 0 && (
            <DropdownMenuRoot>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={`${action} text-ink-2 hover:bg-accent hover:text-ink-1`}
                  title="Move to group"
                >
                  <Folder className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {groups.map((g) => (
                  <DropdownMenuItem key={g.uid} onClick={() => onMoveSelectedToGroup(g.uid)}>
                    <Folder className="size-4" /> {g.title}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenuRoot>
          )}
          {/* Destructive: colour, never size or fill. */}
          <button
            type="button"
            onClick={onDeleteSelected}
            className={`${action} text-destructive hover:bg-destructive/10`}
            title="Delete selected"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        {showPager && (
          <>
            <span className="mono text-[11.5px] text-ink-3">
              {pageStart}–{pageEnd} of {totalFiltered}
            </span>
            <div className="flex items-center">
              <button
                type="button"
                aria-label="Previous page"
                className="rounded p-1 text-ink-3 transition-colors duration-120 hover:bg-accent hover:text-ink-1 disabled:opacity-30"
                disabled={safePage === 0}
                onClick={onPrevPage}
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Next page"
                className="rounded p-1 text-ink-3 transition-colors duration-120 hover:bg-accent hover:text-ink-1 disabled:opacity-30"
                disabled={safePage >= pageCount - 1 && !hasMore}
                onClick={onNextPage}
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </>
        )}
        {!showPager && totalFiltered > 0 && (
          <span className="mono text-[11.5px] text-ink-3">
            {totalFiltered} {totalFiltered === 1 ? 'message' : 'messages'}
          </span>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh"
          className="rounded p-1.5 text-ink-3 transition-colors duration-120 hover:bg-accent hover:text-ink-1 disabled:opacity-40 max-sm:p-2"
        >
          <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
        </div>
        </div>
      </div>
    </div>
  )
}
