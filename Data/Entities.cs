using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;

namespace WatchList0._1.Data
{
    public class UserEntity
    {
        [Key]
        public string Id { get; set; } = default!;
        [Required]
        public string Username { get; set; } = default!;
        [Required]
        public string Password { get; set; } = default!; // demo-only: replace with hashed passwords

        public List<WatchListEntity> WatchLists { get; set; } = new();
        public List<WatchListEntity> SharedWatchLists { get; set; } = new();
        public List<WatchListShareInvitationEntity> ShareInvitations { get; set; } = new();
    }

    public class WatchListEntity
    {
        [Key]
        public int Id { get; set; }
        public string? Name { get; set; }

        public string UserId { get; set; } = default!;
        public UserEntity? User { get; set; }

        public List<MovieEntity> Movies { get; set; } = new();
        public List<UserEntity> SharedWithUsers { get; set; } = new();
        public List<WatchListShareInvitationEntity> ShareInvitations { get; set; } = new();
    }

    public class WatchListShareInvitationEntity
    {
        [Key]
        public int Id { get; set; }

        public int WatchListId { get; set; }
        public WatchListEntity? WatchList { get; set; }

        public string UserId { get; set; } = default!;
        public UserEntity? User { get; set; }
    }

    public class MovieEntity
    {
        [Key]
        public int Id { get; set; }
        [Required]
        public string Title { get; set; } = default!;

        public List<WatchListEntity> WatchLists { get; set; } = new();

        // TMDB fields
        public string? MediaType { get; set; } // "movie" or "tv"
        public int? TmdbId { get; set; }
        public int? Runtime { get; set; } // For movies
        public int? WatchedRuntime { get; set; } // Watched minutes for movies
        public int? NumberOfEpisodes { get; set; } // For series
        public int? WatchedEpisodes { get; set; } // Watched episodes for series
        public int? Rating { get; set; } // 1 to 5 stars
    }
}
