using System;

namespace WatchList0._1.Services
{
    public class SelectedListState
    {
        public int? ListId { get; private set; }
        public string? ListName { get; private set; }

        public event Action? OnChange;

        public void SelectList(int id, string? name)
        {
            var normalizedName = string.IsNullOrWhiteSpace(name) ? "New List" : name;
            if (ListId == id && string.Equals(ListName, normalizedName, StringComparison.Ordinal))
            {
                return;
            }

            ListId = id;
            ListName = normalizedName;
            OnChange?.Invoke();
        }

        public void Clear()
        {
            if (ListId is null && ListName is null)
            {
                return;
            }

            ListId = null;
            ListName = null;
            OnChange?.Invoke();
        }
    }
}
