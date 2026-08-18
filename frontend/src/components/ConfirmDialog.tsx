type ConfirmDialogProps = {
  open: boolean
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({ open, title, message, onConfirm, onCancel }: ConfirmDialogProps) {
  if (!open) return null
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel}>取消</button>
          <button className="danger-button" onClick={onConfirm}>确认删除</button>
        </div>
      </div>
    </div>
  )
}
