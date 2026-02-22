namespace WatchList0._1.Components.Movies
{
    public class MovieEditRequest
    {
        public int MovieId { get; set; }
        public string Title { get; set; } = string.Empty;
        public string? MediaType { get; set; }
        public int? Runtime { get; set; }
        public int? WatchedRuntime { get; set; }
        public int? NumberOfEpisodes { get; set; }
        public int? WatchedEpisodes { get; set; }
        public int? Rating { get; set; }
    }
}
